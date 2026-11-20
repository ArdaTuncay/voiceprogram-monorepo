/** The desktop app's own title strip (the native one is hidden — see
 * desktop/main.js). Draggable to move the window; Windows draws its
 * minimize/maximize/close buttons over its right end. */
export default function DesktopTitleBar() {
  return (
    <div className="desktop-titlebar" aria-hidden="true" translate="no">
      Zircle
    </div>
  );
}
