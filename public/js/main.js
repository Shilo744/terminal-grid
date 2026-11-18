/*
 * Terminal Grid — נקודת הכניסה של הממשק.
 * כאן רק מחברים את המודולים לפי סדר קבוע (אין כאן לוגיקה של תכונות). מבנה המודולים: docs/client-architecture.md
 */
import { renderIcons } from './icons.js';
import { connect } from './connection.js';
import { initLayout, scheduleLayout } from './layout.js';
import { initPanes } from './panes.js';
import { initLaunch, loadInitialInfo } from './launch.js';
import { initSettings, loadSettings } from './settings.js';
import { initSettingsPanel } from './settings-ui/panel.js';
import { initNewMenu } from './new-menu.js';
import { initMoreMenu } from './more-menu.js';
import { initTerminalOptions } from './terminal-options.js';
import { initAppearance } from './appearance.js';
import { initLinks } from './links.js';
import { initAdopt } from './adopt.js';
import { initSidebar, restoreSide } from './sidebar.js';
import { initDuo } from './duo/index.js';
import { initFonts } from './fonts.js';
import { initToolbar } from './toolbar.js';
import { initShortcuts } from './shortcuts.js';
import { initStatus } from './status.js';
import { initTilePreview } from './tile-preview.js';
import { initAttention } from './attention.js';
import { initStartScreen } from './start-screen.js';
import { initPaneMenu } from './pane-menu.js';

// האייקונים קודם לכול: אחר כך כל מודול מחבר את המאזינים שלו (הסדר כאן הוא סדר ההרשמה להודעות מהשרת)
renderIcons();
initSettings();
initLayout();
initPanes();
initLaunch();
initAdopt();
initSidebar();
initDuo();
initFonts();
initTerminalOptions();
initAppearance();
initLinks();
initToolbar();
initShortcuts();
initSettingsPanel();
initNewMenu();
initMoreMenu();
initStatus();
initTilePreview();
initAttention();
initStartScreen();
initPaneMenu();

(async function init() {
  // ההגדרות קודם: הטרמינלים הראשונים נפתחים כבר עם הגופן וההגדרות הנכונים
  await Promise.all([loadInitialInfo(), loadSettings()]);
  // xterm מודד את גודל התא פעם אחת לפי הגופן, אז מחכים שהגופן ייטען לפני שיוצרים טרמינל
  try {
    const fontsReady = Promise.all([
      document.fonts.load("14px 'TG Cascadia'"),
      document.fonts.load("bold 14px 'TG Cascadia'"),
      document.fonts.load("14px 'TG Cascadia'", 'שלום'),
    ]);
    // לעולם לא חוסמים את ההתחברות יותר משתי שניות וחצי בגלל גופן
    await Promise.race([fontsReady, new Promise((r) => setTimeout(r, 2500))]);
  } catch { /* falls back to the system font */ }
  restoreSide();
  connect();
  scheduleLayout();
})();
