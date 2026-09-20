export const THEME_KEY = "anveshan-theme";

export function savedThemeScript(): string {
  // Runs before paint (see layout head): avoids a theme flash.
  return `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;
}
