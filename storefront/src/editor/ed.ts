/**
 * Click-to-edit tagging. The renderer marks every editable element with data-nova-el="<registry key>" (and every
 * section with data-nova-section="<section id>"). The keys are exactly the ones in contracts/editable-elements.json,
 * which the tests check against what each section component really renders. The attributes are inert on the public
 * site: only the editor bridge (editor/bridge.ts, active solely inside Store Builder's verified preview) reads them.
 */
export const ed = (key: string) => ({ "data-nova-el": key });
