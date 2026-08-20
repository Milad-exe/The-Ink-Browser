/**
 * Where a floating panel goes, and how big it is.
 *
 * Every overlay used to invent its own answer: the menu sat at a hardcoded
 * y=90 and 10px in from the right, downloads and extensions used
 * anchor.bottom+6, site info used anchor.y+4 and clamped to 8, the password
 * prompt used a hardcoded y=52 and 12px in, and the widths ran 240 / 268 /
 * 300 / 320 / 340 / 360. On their own each looked fine; together the panels
 * read as loose parts sitting on top of a browser rather than as part of it.
 *
 * The rule here is the one the window already follows: the page card's top
 * edge (SHELL_TOP + BAR_H + SHELL_PAD) and the shell's gutter (SHELL_PAD).
 * A panel hung off a toolbar button therefore opens flush with the top of the
 * page, and its outer edge lines up with the page card's outer edge.
 *
 * The three geometry constants mirror features/tabs.js and the METRICS block
 * in renderer/styles/ui.css — change one, change all three.
 */
const SHELL_TOP = 6;   // air above the chrome        (--shell-top)
const BAR_H = 44;      // toolbar                     (--bar-h)
const SHELL_PAD = 8;   // gutter around the page card (--shell-pad)

/** The page card's top edge: where a toolbar-anchored panel starts. */
const CARD_TOP = SHELL_TOP + BAR_H + SHELL_PAD;

/** Panel corner radius — the same step as .surface-card's --r-lg. */
const PANEL_RADIUS = 12;

/**
 * Two widths, not six. A panel is either a list of short labels (a menu, a
 * folder) or a panel with content in it (downloads, extensions, site info,
 * the prompts).
 */
const W_SM = 260;
const W_MD = 320;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

/**
 * Bounds for a panel floating over `win`.
 *
 * @param {BrowserWindow} win
 * @param {object} opts
 * @param {{left?:number,right?:number,bottom?:number}} [opts.anchor]
 *        The trigger's rect in window coordinates. Omit for a panel that
 *        belongs to the window rather than to a control (the app menu).
 * @param {number} opts.width
 * @param {number} opts.height   desired height; trimmed to fit the window
 * @param {'left'|'right'} [opts.align='right']  which edge tracks the anchor
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function panelBounds(win, { anchor = null, width, height, align = 'right' }) {
    const b = win.getContentBounds ? win.getContentBounds() : win.getBounds();
    const maxX = Math.max(SHELL_PAD, b.width - SHELL_PAD - width);
    // Anything whose trigger sits in the toolbar strip belongs to the toolbar.
    const fromToolbar = !anchor || (anchor.bottom ?? 0) <= SHELL_TOP + BAR_H;

    let x;
    if (align === 'left' && anchor)
        x = Math.round(anchor.left ?? anchor.x ?? 0);
    else if (fromToolbar)
        // The toolbar's trailing icons are one cluster ending at the shell's
        // gutter, so panels hung off them share the page card's right edge.
        // Aligning each to its own button instead moved the panel 32px sideways
        // depending on which icon you pressed.
        x = maxX;
    else
        x = Math.round((anchor.right ?? b.width) - width);

    // Below the trigger, but never above the page card's top edge — a panel
    // must not tuck under the toolbar.
    let y = clamp(anchor ? Math.round((anchor.bottom ?? 0) + SHELL_PAD) : CARD_TOP,
        CARD_TOP, Math.max(CARD_TOP, b.height - SHELL_PAD));
    let h = Math.min(height, b.height - y - SHELL_PAD);
    // Triggered from low in the window (the sidebar foot): open upwards rather
    // than being squashed against the bottom edge.
    if (h < height && anchor && Number.isFinite(anchor.top)) {
        const above = Math.round(anchor.top) - SHELL_PAD - height;
        if (above >= CARD_TOP) {
            y = above;
            h = height;
        }
    }

    return { x: clamp(x, SHELL_PAD, maxX), y, width, height: Math.max(80, h) };
}

module.exports = { panelBounds, CARD_TOP, SHELL_TOP, SHELL_PAD, BAR_H, PANEL_RADIUS, W_SM, W_MD };
