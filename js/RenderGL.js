define(["Q", "glMatrix", "util"], function(Q, glMatrix, util) {
    'use strict';

    var create = Q.promised(function(canvas, dimensions, visible) {
        visible = visible || {};

        var renderer = {};

        // The dimensions of a canvas, by default, do not accurately reflect its size on screen (as
        // set in the HTML/CSS/etc.) This changes the canvas size to match its size on screen.
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;

        var gl = canvas.getContext("experimental-webgl", {antialias: true, premultipliedAlpha: false});
        if(gl === null) {
            throw new Error("Could not initialize WebGL");
        }

        // Set up WebGL settings
        gl.enable(gl.BLEND);
        // gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
        gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 0);
        // Lines should be 1px wide
        gl.lineWidth(1);

        // Populate the renderer object with default values, empty containers, etc.
        renderer.gl = gl;
        renderer.canvas = canvas;
        renderer.buffers = {};
        renderer.programs = {};
        renderer.elementsPerPoint = 2;
        renderer.numPoints = 0;
        renderer.numEdges = 0;
        renderer.numMidPoints = 0;

        // For each module function that takes a renderer as the first argument, bind a version
        // to this renderer object, with the renderer argument curried in.
        renderer.setCamera2d = setCamera2d.bind(this, renderer);
        renderer.createBuffer = createBuffer.bind(this, renderer);
        renderer.render = render.bind(this, renderer);
        renderer.createProgram = createProgram.bind(this, renderer);
        renderer.setVisible = setVisible.bind(this, renderer);
        renderer.isVisible = isVisible.bind(this, renderer);

        renderer.visible = {points: true, edges: true, midpoints: false, midedges: false};
        renderer.setVisible(visible);


        return Q.all(
            ['point', 'edge', 'midpoint', 'midedge'].map(function (name) {
                return renderer.createProgram(name + '.vertex', name + '.fragment');
        }))
        .spread(function (pointProgram, edgeProgram, midpointProgram, midedgeProgram) {
            renderer.programs["points"] = pointProgram;
            renderer.programs["edges"] = edgeProgram;
            renderer.programs["midpoints"] = midpointProgram;
            renderer.programs["midedges"] = midedgeProgram;

            // TODO: Enlarge the camera by the (size of gl points / 2) so that points are fully
            // on screen even if they're at the edge of the graph.
            return renderer.setCamera2d(-0.01, dimensions[0] + 0.01, -0.01, dimensions[1] + 0.01);
        });
    });


    function createProgram(renderer, vertexShaderID, fragmentShaderID) {
        var gl = renderer.gl;

        var pragObj = {};

        pragObj.renderer = renderer;
        pragObj.glProgram = gl.createProgram();
        pragObj.bindVertexAttrib = bindVertexAttrib.bind(this, pragObj);
        pragObj.use = function() {
            gl.useProgram(pragObj.glProgram);
        }
        pragObj.attributes = {};

        return Q.all([
            util.getSource(vertexShaderID + ".glsl"),
            util.getSource(fragmentShaderID + ".glsl")
        ])
        .spread(function(vertShaderSource, fragShaderSource) {

            function compileShader(program, shaderSource, shaderType) {
                var shader = renderer.gl.createShader(shaderType);
                renderer.gl.shaderSource(shader, shaderSource);
                renderer.gl.compileShader(shader);
                if(!renderer.gl.getShaderParameter(shader, renderer.gl.COMPILE_STATUS)) {
                    throw new Error("Error compiling WebGL shader (shader type: " + shaderType + ")");
                }
                if(!renderer.gl.isShader(shader)) {
                    throw new Error("After compiling shader, WebGL is reporting it is not valid");
                }
                renderer.gl.attachShader(program.glProgram, shader);

                return shader;
            }

            pragObj.vertexShader   = compileShader(pragObj, vertShaderSource, gl.VERTEX_SHADER);
            pragObj.fragmentShader = compileShader(pragObj, fragShaderSource, gl.FRAGMENT_SHADER);

            gl.linkProgram(pragObj.glProgram);
            return pragObj;
        });
    }


    // // TODO: Move back to this Mat4-based MVP matrix. However, retain the simple
    // // (left, right, top, bottom) arguments. Perhaps make the MVP matrix an object field
    // // (initialized to the identity matrix) and have some simple function for move, rotate, etc.
    // function setCamera(renderer, position, target) {
    //  return Q.promise(function(resolve, reject, notify) {
    //      renderer.gl.viewport(0, 0, renderer.canvas.width, renderer.canvas.height);
    //      // console.debug("Viewport:", renderer.gl.getParameter(renderer.gl.VIEWPORT));

    //      var perspectiveMatrix = glMatrix.mat4.create();
    //      // Setup a basic orthographic projection
    //      glMatrix.mat4.ortho(perspectiveMatrix, 0, 1, 0, 1, -1, 1);

    //      // Setup a regular projection matrix
    //      // var aspect = renderer.canvas.clientWidth / renderer.canvas.clientHeight;
    //      // console.debug("Aspect ratio:", aspect);
    //      // glMatrix.mat4.perspective(pMatrix, 50, aspect, 0, 100);

    //      var viewMatrix = glMatrix.mat4.create();
    //      glMatrix.mat4.lookAt(viewMatrix, position, target, glMatrix.vec3.fromValues(0, 1, 0));

    //      var mvpMatrix = glMatrix.mat4.create();
    //      glMatrix.mat4.multiply(mvpMatrix, perspectiveMatrix, viewMatrix);

    //      var mvpLocation = renderer.gl.getUniformLocation(renderer.program, "mvp");
    //      renderer.gl.uniformMatrix4fv(mvpLocation, false, mvpMatrix);

    //      resolve(renderer);
    //  });
    // }


    var setCamera2d = Q.promised(function(renderer, left, right, bottom, top) {
        renderer.gl.viewport(0, 0, renderer.canvas.width, renderer.canvas.height);

        var lr = 1 / (left - right),
            bt = 1 / (bottom - top);

        var mvpMatrix = glMatrix.mat2d.create();
        glMatrix.mat2d.scale(mvpMatrix, mvpMatrix, glMatrix.vec2.fromValues(-2 * lr, -2 * bt));
        glMatrix.mat2d.translate(mvpMatrix, mvpMatrix, glMatrix.vec2.fromValues((left+right)*lr, (top+bottom)*bt));

        var mvpMat3 = glMatrix.mat3.create();
        glMatrix.mat3.fromMat2d(mvpMat3, mvpMatrix);

        ['points', 'edges', 'midpoints', 'midedges'].forEach(function (name) {
            var program = renderer.programs[name].glProgram;
            renderer.gl.useProgram(program);
            var mvpLocation = renderer.gl.getUniformLocation(program, "mvp");
            renderer.gl.uniformMatrix3fv(mvpLocation, false, mvpMat3);
        })

        return renderer;
    });


    var createBuffer = Q.promised(function(renderer, data) {
        var buffer = renderer.gl.createBuffer();
        var bufObj = {
            "buffer": buffer,
            "gl": renderer.gl
        };

        bufObj.delete = Q.promised(function() {
            renderer.gl.deleteBuffer(buffer);
            return renderer;
        })
        bufObj.write = write.bind(this, bufObj);

        if(data) {
            return bufObj.write(data);
        } else {
            return bufObj;
        }
    });


    var write = Q.promised(function(buffer, data) {
        buffer.gl.bindBuffer(buffer.gl.ARRAY_BUFFER, buffer.buffer);
        buffer.gl.bufferData(buffer.gl.ARRAY_BUFFER, data, buffer.gl.DYNAMIC_DRAW);
        return buffer;
    });


    /**
     * Shortcut method to find the location of an attribute, bind a buffer, and then set the
     * attribute to the buffer
     *
     * @param program - the program object with the attribute you want to bind to the buffer
     * @param buffer - the buffer you want to bind to the attribute
     * @param {string} attribute - the name of the attribute you wish to bind
     * @param {number} elementsPerItem - the number of elements to use for each rendered item (e.g.,
     * use two floats per point). Passed directly to gl.vertexAttribPointer() as 'size' argument.
     * @param glType - the WebGL type of the array (e.g., gl.FLOAT)
     * @param {boolean} normalize - should the data be normalized before being processed by shaders
     * @param {number} stride - the number of bytes between item elements (normally
     * elementsPerItem * sizeof(type))
     * @param {number} offset - the number of bytes from the start of the buffer to begin reading
     */
    function bindVertexAttrib(program, buffer, attribute, elementsPerItem, glType, normalize, stride, offset) {
        var gl = program.renderer.gl;
        var location = gl.getAttribLocation(program.glProgram, attribute);

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, elementsPerItem, glType, normalize, stride, offset);

        return program;
    }



    /**
     * Enable or disable the drawing of elements in the scene. Elements are one of: points, edges,
     * midpoints, midedges.
     *
     * @param renderer - the renderer object created with GLRunner.create()
     * @param {Object} visible - An object with keys for 0 or more objects to set the visibility
     * for. Each value should be true or false.
     * @returns the renderer object passed in, with visibility options updated
     */
    function setVisible(renderer, visible) {
        util.extend(renderer.visible, visible);

        return renderer;
    }


    /**
     * Determines if the element passed in should be visible in image
     *
     * @param renderer - the renderer object created with GLRunner.create()
     * @param element - the name of the element to check visibility for
     *
     * @returns a boolean value determining if the object should be visible (false by default)
     */
    function isVisible(renderer, element) {
        // TODO: check the length of the associated buffer to see if it's >0; return false if not.
        return (renderer.visible[element] || false);
    }


    var render = Q.promised(function(renderer) {
        var gl = renderer.gl;

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // If there are no points in the graph, don't render anything
        if(renderer.numPoints < 1) {
            return renderer;
        }

        gl.depthFunc(gl.LEQUAL);

        if (renderer.isVisible("points")) {
            renderer.programs["points"].use();
            renderer.programs["points"].bindVertexAttrib(renderer.buffers.curPoints, "curPos",
                renderer.elementsPerPoint, gl.FLOAT, false,
                renderer.elementsPerPoint * Float32Array.BYTES_PER_ELEMENT, 0)
            gl.drawArrays(gl.POINTS, 0, renderer.numPoints);
        }

        if (renderer.isVisible("midpoints")) {
            renderer.programs["midpoints"].use();
            renderer.programs["midpoints"].bindVertexAttrib(renderer.buffers.curMidPoints, "curPos",
                renderer.elementsPerPoint, gl.FLOAT, false,
                renderer.elementsPerPoint * Float32Array.BYTES_PER_ELEMENT, 0);
            gl.drawArrays(gl.POINTS, 0, renderer.numMidPoints);
        }

        if(renderer.numEdges > 0) {
            // Make sure to draw the edges behind the points
            gl.depthFunc(gl.LESS);

            if (renderer.isVisible("edges")) {
                renderer.programs["edges"].use();
                renderer.programs["edges"].bindVertexAttrib(renderer.buffers.springs, "curPos",
                    renderer.elementsPerPoint, gl.FLOAT, false,
                    renderer.elementsPerPoint * Float32Array.BYTES_PER_ELEMENT, 0);
                gl.drawArrays(gl.LINES, 0, renderer.numEdges * 2);
            }

            if (renderer.isVisible("midedges")) {
                renderer.prorams["midedges"].use();
                renderer.prorams["midedges"].bindVertexAttrib(renderer.buffers.midSprings, "curPos",
                    renderer.elementsPerPoint, gl.FLOAT, false,
                    renderer.elementsPerPoint * Float32Array.BYTES_PER_ELEMENT, 0);
                gl.drawArrays(gl.LINES, 0, renderer.numMidEdges * 2);
            }

        }

        gl.finish();

        return renderer;
    });


    return {
        "create": create,
        "createProgram": createProgram,
        "setCamera2d": setCamera2d,
        "createBuffer": createBuffer,
        "write": write,
        "bindVertexAttrib": bindVertexAttrib,
        "setVisible": setVisible,
        "isVisible": isVisible,
        "render": render
    };
});
