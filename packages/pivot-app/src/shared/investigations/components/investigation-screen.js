import _ from 'underscore';
import SplitPane from 'react-split-pane';
import Visualization from './visualization';
import styles from './investigation-screen.less';
import { Investigation, InvestigationHeader } from 'pivot-shared/investigations';


export default function InvestigationScreen({
    templates = [],
    investigations = [],
    activeInvestigation = {},
    selectInvestigation,
    createInvestigation,
    copyInvestigation,
    saveInvestigation,
    user,
    saveLayout
}) {

    const { tags: activeTags = [] } = activeInvestigation || {};
    const relevantTemplates =
        activeTags.length > 0 ?
            templates.filter(({ tags: templateTags = [] }) =>
                _.intersection(templateTags, activeTags).length > 0
            ) :
            templates;

    return (
        <div className={styles['investigation-all']}>
            <div className={styles['investigation-split']}>
                <SplitPane split='vertical' minSize={300} defaultSize={300}>
                    <div style={{ height: `100%` }}>
                        <InvestigationHeader
                            key={`investigation-header:${activeInvestigation.id}`}
                            investigations={investigations}
                            activeInvestigation={activeInvestigation}
                            selectInvestigation={selectInvestigation}
                            createInvestigation={createInvestigation}
                            copyInvestigation={copyInvestigation}
                            saveInvestigation={saveInvestigation}
                            user={user}
                            saveLayout={saveLayout}
                        />
                        <Investigation
                            key={`investigation:${activeInvestigation.id}`}
                            data={activeInvestigation}
                            investigations={investigations}
                            templates={relevantTemplates}
                            selectInvestigation={selectInvestigation}
                        />
                    </div>
                    { activeInvestigation.status &&
                        <Visualization investigation={activeInvestigation}/>
                        || undefined
                    }
               </SplitPane>
            </div>
        </div>
    );
}
