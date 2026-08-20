"use strict";
// IIFE: compiled as a classic <script>; the wrapper keeps this page's
// top-level names out of the shared global scope.
(() => {
    document.addEventListener('DOMContentLoaded', () => {
        const T = (key, fallback) => {
            try { const v = window.Ink?.i18n?.t(key); return (v && v !== key) ? v : fallback; }
            catch (e) { return fallback; }
        };
        try {
            window.Ink.i18n.init(window.inkI18n?.getSync() || {});
            window.Ink.i18n.apply(document);
        }
        catch (e) { window.inkLog?.debug('find', 'i18n: ' + e); }
        const findInput = document.getElementById('find-input');
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        const closeBtn = document.getElementById('close-btn');
        const matchCounter = document.getElementById('match-counter');
        let currentMatchIndex = 0;
        let totalMatches = 0;
        let searchTimeout = null;
        findInput.focus();
        findInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.trim();
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            if (searchTerm) {
                searchTimeout = setTimeout(() => {
                    window.findAPI.search(searchTerm);
                }, 300);
            }
            else {
                window.findAPI.clearSearch();
                updateMatchCounter(0, 0);
            }
        });
        findInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (searchTimeout) {
                    clearTimeout(searchTimeout);
                    searchTimeout = null;
                }
                const searchTerm = findInput.value.trim();
                if (searchTerm) {
                    window.findAPI.search(searchTerm);
                    setTimeout(() => {
                        if (e.shiftKey) {
                            findPrevious();
                        }
                        else {
                            findNext();
                        }
                    }, 50);
                }
            }
            else if (e.key === 'Escape') {
                closeDialog();
            }
        });
        prevBtn.addEventListener('click', findPrevious);
        nextBtn.addEventListener('click', findNext);
        closeBtn.addEventListener('click', closeDialog);
        function findNext() {
            const searchTerm = findInput.value.trim();
            if (searchTerm) {
                window.findAPI.findNext();
            }
        }
        function findPrevious() {
            const searchTerm = findInput.value.trim();
            if (searchTerm) {
                window.findAPI.findPrevious();
            }
        }
        function closeDialog() {
            if (searchTimeout) {
                clearTimeout(searchTimeout);
                searchTimeout = null;
            }
            window.findAPI.close();
        }
        function updateMatchCounter(current, total) {
            currentMatchIndex = current;
            totalMatches = total;
            if (total === 0) {
                matchCounter.textContent = T('find.none', 'No matches');
                matchCounter.classList.add('none');
                prevBtn.disabled = true;
                nextBtn.disabled = true;
            }
            else {
                matchCounter.textContent = T('find.count', '{current} of {total}')
                    .replace('{current}', current).replace('{total}', total);
                matchCounter.classList.remove('none');
                prevBtn.disabled = false;
                nextBtn.disabled = false;
            }
        }
        if (window.findAPI) {
            window.findAPI.onMatchesUpdated((current, total) => {
                updateMatchCounter(current, total);
            });
        }
    });
})();
