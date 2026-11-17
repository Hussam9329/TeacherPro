// Every page's stylesheet, loaded with the app shell in one fixed order.
//
// The pages themselves are separate chunks (see layout.tsx), but their styles
// are not: several of these files style classes used on other pages, and which
// rule wins between two files depends on the order they load in. Loading a
// file with whichever page is opened first would change that order from visit
// to visit, so components do not import their stylesheets themselves: every
// stylesheet is listed here once, in the order the single bundle had. A new
// stylesheet goes at the end of this list.
import "./tp-modal.css";
import "./tp-list.css";
import "./code-closures-dialog.css";
import "./student-code-buttons.css";
import "./calls.css";
import "./mirmaz-pro-dialog.css";
import "./grace-periods-dialog.css";
import "./leaves-dialog.css";
import "./pledge-list-dialog.css";
import "./text-shortcuts-dialog.css";
import "./top-students-dialog.css";
import "./course-builder.css";
import "./courses.css";
import "./chapters.css";
import "./student-register.css";
import "./telegram-extract-dialog.css";
import "./student-bulk-text-import.css";
import "./student-registry-results.css";
import "./student-card.css";
import "./student-registry.css";
import "./exam-new.css";
import "./grade-records.css";
import "./course-checkbox-filter.css";
