"use strict";

var Q = require('q');
var Long = require('./Long.js');
var log         = require('common/logger.js');
var logger      = log.createLogger('graph-viz:data:matrixloader');
var perf        = require('common/perfStats.js').createPerfMonitor();
var zlib = require("zlib");

var exports = {
    ls: function (matrixJson) {
        //FIXME do not do as eval

        var parts = matrixJson.split('/');
        parts.pop();
        var base = parts.join('/') + '/';

        var file = Q.denodeify(require('fs').readFile)(matrixJson, {encoding: 'utf8'})

        return file
            .then(eval)
            .then(function (lst) {
                return lst.map(function (f) {
                    return {KB: f.KB, 'f': base + f.f};
                });
            });
    },


    loadBinary: function (nodeBuffer) { // -> Promise Binary
        logger.trace("Loading binary");

        //unnecessary?
        var t0 = new Date().getTime();

        function Binary (buf) {
            return {
                edges: buf.subarray(4),
                min: buf[0],
                max: buf[1],
                numNodes: buf[2],
                numEdges: buf[3]
            };
        }

        return Binary(new Uint32Array((new Uint8Array(nodeBuffer)).buffer));
    },


    load: function (str) {
        var t0 = new Date().getTime();
        perf.startTiming('graph-viz:data:matrixloader');
        //http://bl.ocks.org/mbostock/2846454
        var nodes = [];
        var links = str
          .split(/\n/g) // split lines
          .filter(function(d) { return d.charAt(0) != "%"; }) // skip comments
          .slice(1, -1) // skip header line, last line
          .map(function(d) {
            d = d.split(/\s+/g);
            var source = d[0] - 1, target = d[1] - 1;
            return {
                source: nodes[source] || (nodes[source] = {index: source}),
                target: nodes[target] || (nodes[target] = {index: target})
            };
        });

        //might be better for a perflog?
        perf.endTiming('graph-viz:data:matrixloader');

        return {
          nodes: nodes,
          links: links
        };
    }, //load


    loadGeo: function(nodeBuffer) { // -> Promise Binary
        var t0 = new Date().getTime();

        //is the %s ever going to be formatted?
        logger.debug("Loading Geo file %s");

        function Binary (buf) {
            var f32 = new Float32Array(buf.buffer);
            var i32 = new Int32Array(buf.buffer);
            var ui32 = buf;
            var struct32Length = 1 + 2 * (2 + 1 + 1);
            var struct8Length = 4 * (1 + 2 * (2 + 1 + 1));

            function toUTC(low, high) {
                return new Date(Long.fromBits(low, high, true).toNumber());
            }

            return {
                numEdges: buf.byteLength / struct8Length,
                id: function (i) { return ui32[i * struct32Length]; },
                startTime: function (i) {
                    var idx = i * struct32Length + 1;
                    return toUTC(i32[idx], i32[idx + 1]);
                },
                startLat: function (i) { return f32[i * struct32Length + 3]; },
                startLng: function (i) { return f32[i * struct32Length + 4]; },
                endTime: function (i) {
                    var idx = i * struct32Length + 5;
                    return toUTC(i32[idx], i32[idx + 1]);
                },
                endLat: function (i) { return f32[i * struct32Length + 7]; },
                endLng: function (i) { return f32[i * struct32Length + 8]; }
            };
        }

        logger.trace("Loading geo data with node.js fs module");
        return Binary(new Uint32Array((new Uint8Array(nodeBuffer)).buffer));
    },


    getGeoBounds: function (binary) {
        var minLat = Number.POSITIVE_INFINITY;
        var maxLat = Number.NEGATIVE_INFINITY;
        var minLng = Number.POSITIVE_INFINITY;
        var maxLng = Number.NEGATIVE_INFINITY;
        var avgLat = 0;
        var avgLng = 0;
        var sLat = 0;
        var sLng = 0;
        for (var i = 0; i < binary.numEdges; i++) {
            minLat = Math.min(Math.min(minLat, binary.startLat(i)), binary.endLat(i));
            maxLat = Math.max(Math.max(maxLat, binary.startLat(i)), binary.endLat(i));
            minLng = Math.min(Math.min(minLng, binary.startLng(i)), binary.endLng(i));
            maxLng = Math.max(Math.max(maxLng, binary.startLng(i)), binary.endLng(i));

            var newAvgLat = avgLat + (binary.startLat(i) + binary.endLat(i) - 2 * avgLat) / (i + 2);
            sLat = sLat
                + (binary.startLat(i) - newAvgLat) * (binary.startLat(i) - avgLat)
                + (binary.endLat(i) - newAvgLat) * (binary.endLat(i) - avgLat);
            avgLat = newAvgLat;

            var newAvgLng = avgLng + (binary.startLng(i) + binary.endLng(i) - 2 * avgLng) / (i + 2);
            sLng = sLng
                + (binary.startLng(i) - newAvgLng) * (binary.startLng(i) - avgLng)
                + (binary.endLng(i) - newAvgLng) * (binary.endLng(i) - avgLng);
            avgLng = newAvgLng;
        }
        var stdLat = Math.sqrt(sLat/(binary.numEdges - 1));
        var stdLng = Math.sqrt(sLng/(binary.numEdges - 1));

        // normalize_d(v_d) = (v_d + d.scale.c)/d.scale.x

        // Henceforth, whoever uses one-letter variable names for non-temporary variables owes
        // everybody else lunch
        return {
            lat: {min: minLat, max: maxLat, stats: {avg: avgLat, std: stdLat}, scale: {c: -(avgLat - 1.5 * stdLat), x: 3 * stdLat}},
            lng: {min: minLng, max: maxLng, stats: {avg: avgLng, std: stdLng}, scale: {c: -(avgLng - 1.5 * stdLng), x: 3 * stdLng}}
        };
    },


    /**
     * Takes geo data returned by loadGeo and returns an object containing and edge and points
     * array, with the points being properly normalized to be on [1,1]
     * @param {number} keepPercent - the decimal percentage of the data to include in the output
     * (defaults to 0.3)
     */
    processGeo: function(geoData, keepPercent) {
        keepPercent = keepPercent || 0.3;
        var points = [],
            edges = [],
            bounds = exports.getGeoBounds(geoData);

        for(var i = 0; i < geoData.numEdges; i++) {
            if(Math.random() > keepPercent) { continue; }

            points.push([(geoData.startLng(i) + bounds.lng.scale.c) / (bounds.lng.scale.x), (geoData.startLat(i) + bounds.lat.scale.c) / (bounds.lat.scale.x)]);
            points.push([(geoData.endLng(i) + bounds.lng.scale.c) / (bounds.lng.scale.x), (geoData.endLat(i) + bounds.lat.scale.c) / (bounds.lat.scale.x)]);
            edges.push([points.length - 2, points.length - 1]);
        }

        return {"points": points, "edges": edges};
    }
};

module.exports = exports;
