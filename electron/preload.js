// Tells the page it runs in the desktop app, before it paints: style.css makes room for the window buttons
// (`app-darwin`: on the left of the tab bar; `app-win32`: on its right).
const mark = () => document.documentElement.classList.add('app', `app-${process.platform}`);
if (document.documentElement) mark();
else addEventListener('DOMContentLoaded', mark);
