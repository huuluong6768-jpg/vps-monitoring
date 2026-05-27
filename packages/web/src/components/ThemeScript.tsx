/** Blocking head script: applies saved theme before first paint (no flash). */
export function ThemeScript() {
  const code = `(function(){try{var k=${JSON.stringify('vpsmon-theme')};var v=localStorage.getItem(k);var r=document.documentElement;r.classList.toggle('light',v==='light');}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
