(() => {
    'use strict';
    const role = window.splitUI?.role?.() || 'divider';
    const divider = document.getElementById('divider');
    const handle = document.getElementById('handle');
    let markCurrent = null;

    if (role === 'divider') {
        divider.classList.remove('hidden');
        // The pointer leaves this 14px strip on the first move, so main takes
        // the drag over from here (it watches the page views' input streams and
        // ends on their mouse-up). All this side does is start and stop it.
        divider.addEventListener('pointerdown', (e) => {
            if (e.button !== 0)
                return;
            e.preventDefault();
            document.body.classList.add('dragging');
            window.splitUI.resizeStart();
        });
        const stop = () => {
            if (!document.body.classList.contains('dragging'))
                return;
            document.body.classList.remove('dragging');
            window.splitUI.resizeEnd();
        };
        document.addEventListener('pointerup', stop);
        document.addEventListener('pointercancel', stop);
        window.addEventListener('blur', stop);
    }
    else {
        const pane = role === 'pane1' ? 1 : 0;
        handle.classList.remove('hidden');
        for (const btn of handle.querySelectorAll('.dir')) {
            btn.addEventListener('click', () => window.splitUI.move(pane, btn.dataset.dir));
        }
        // Mark where this pane already sits, so the pad reads as a position
        // picker rather than four identical arrows.
        markCurrent = (orient) => {
            const cur = orient === 'col' ? (pane === 0 ? 'top' : 'bottom') : (pane === 0 ? 'left' : 'right');
            for (const btn of handle.querySelectorAll('.dir'))
                btn.classList.toggle('current', btn.dataset.dir === cur);
        };
        markCurrent('row');
    }

    // Cursor + grip axis follow the current split orientation.
    window.splitUI?.onOrient?.((o) => {
        const orient = o === 'col' ? 'col' : 'row';
        document.body.dataset.orient = orient;
        markCurrent?.(orient);
    });
})();
