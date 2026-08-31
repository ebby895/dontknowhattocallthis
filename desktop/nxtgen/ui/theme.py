"""Visual system: palette, DPI handling, and vector icons.

Icons are drawn from inline SVG paths and recoloured at runtime, so the app
ships without binary assets and stays crisp at any scale factor.
"""

from __future__ import annotations

from PyQt6.QtCore import QByteArray, Qt
from PyQt6.QtGui import QColor, QIcon, QPainter, QPixmap
from PyQt6.QtSvg import QSvgRenderer


class Palette:
    BG          = "#0f1115"
    PANEL       = "#171a21"
    PANEL_ALT   = "#1e222b"
    LINE        = "#2a2f3a"
    LINE_LIGHT  = "#39404e"

    TEXT        = "#e6e9ef"
    TEXT_MUTED  = "#8b93a3"
    TEXT_DIM    = "#5f6675"

    ACCENT      = "#ff9900"   # Amazon orange
    ACCENT_DARK = "#cc7a00"
    ACCENT_SOFT = "rgba(255, 153, 0, 0.12)"

    OK          = "#4ade80"
    WARN        = "#fbbf24"
    DANGER      = "#f87171"
    INFO        = "#60a5fa"

    # Categorical series for charts, ordered for contrast when adjacent.
    SERIES = ["#ff9900", "#60a5fa", "#4ade80", "#c084fc",
              "#fbbf24", "#f87171", "#34d399", "#a78bfa"]


# 24x24 viewBox paths, stroked rather than filled so one path works at any size.
ICON_PATHS = {
    "dashboard": "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
    "queue":     "M4 6h16M4 12h16M4 18h10",
    "revenue":   "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
    "pipeline":  "M4 4h16v4H4zM8 8v4h8V8M10 12v4h4v-4M11 16v4h2v-4",
    "chart":     "M3 3v18h18M7 15l4-4 3 3 5-6",
    "clock":     "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
    "settings":  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
                 "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06"
                 "a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09"
                 "A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83"
                 "l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09"
                 "A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83"
                 "l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09"
                 "a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83"
                 "l-.06.06a1.65 1.65 0 0 0-.33 1.82V10a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09"
                 "a1.65 1.65 0 0 0-1.51 1z",
    "play":      "M5 3l14 9-14 9V3z",
    "stop":      "M6 6h12v12H6z",
    "refresh":   "M21 2v6h-6M3 22v-6h6M3.5 9a9 9 0 0 1 14.85-3.36L21 8M20.5 15a9 9 0 0 1-14.85 3.36L3 16",
    "check":     "M20 6L9 17l-5-5",
    "x":         "M18 6L6 18M6 6l12 12",
    "external":  "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",
    "copy":      "M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z"
                 "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
    "alert":     "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86"
                 "a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
    "bolt":      "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
}


def icon(name: str, color: str = Palette.TEXT, size: int = 20) -> QIcon:
    """Render a named icon at the given colour and logical size."""
    path = ICON_PATHS.get(name)
    if not path:
        return QIcon()

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
        f'width="{size}" height="{size}" fill="none" stroke="{color}" '
        f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        f'<path d="{path}"/></svg>'
    )

    renderer = QSvgRenderer(QByteArray(svg.encode()))
    # Render at 3x and let Qt downsample, so the icon stays sharp on a 150% or
    # 200% Windows display without shipping multiple assets.
    pm = QPixmap(size * 3, size * 3)
    pm.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pm)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    renderer.render(painter)
    painter.end()
    pm.setDevicePixelRatio(3.0)
    return QIcon(pm)


STYLESHEET = f"""
QWidget {{
    background: {Palette.BG};
    color: {Palette.TEXT};
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
    font-size: 10pt;
}}

QMainWindow, QDialog {{ background: {Palette.BG}; }}

/* ---- Banner ----------------------------------------------------------- */
#Banner {{
    background: {Palette.PANEL};
    border-bottom: 1px solid {Palette.LINE};
}}
#BannerTitle {{
    font-size: 16pt;
    font-weight: 700;
    color: {Palette.ACCENT};
    letter-spacing: 0.02em;
}}

/* ---- Sidebar ---------------------------------------------------------- */
#Sidebar {{
    background: {Palette.PANEL};
    border-right: 1px solid {Palette.LINE};
}}
#SidebarTitle {{
    font-size: 13pt;
    font-weight: 600;
    padding: 18px 16px 4px;
    color: {Palette.TEXT};
}}
#SidebarTag {{
    font-size: 8.5pt;
    color: {Palette.ACCENT};
    padding: 0 16px 16px;
}}
QListWidget#Nav {{
    background: transparent;
    border: none;
    outline: none;
    padding: 6px 8px;
}}
QListWidget#Nav::item {{
    padding: 10px 12px;
    border-radius: 7px;
    color: {Palette.TEXT_MUTED};
    margin-bottom: 2px;
}}
QListWidget#Nav::item:hover {{
    background: {Palette.PANEL_ALT};
    color: {Palette.TEXT};
}}
QListWidget#Nav::item:selected {{
    background: {Palette.ACCENT_SOFT};
    color: {Palette.ACCENT};
    font-weight: 600;
}}

/* ---- Cards ------------------------------------------------------------ */
#Card {{
    background: {Palette.PANEL};
    border: 1px solid {Palette.LINE};
    border-radius: 10px;
}}
#CardTitle {{
    color: {Palette.TEXT_MUTED};
    font-size: 8.5pt;
    font-weight: 600;
    letter-spacing: 0.06em;
}}
#StatValue  {{ font-size: 22pt; font-weight: 700; color: {Palette.TEXT}; }}
#StatAccent {{ font-size: 22pt; font-weight: 700; color: {Palette.ACCENT}; }}
#StatOk     {{ font-size: 22pt; font-weight: 700; color: {Palette.OK}; }}
#StatSub    {{ font-size: 8.5pt; color: {Palette.TEXT_DIM}; }}

#PageTitle {{ font-size: 17pt; font-weight: 600; padding: 2px 0 2px; }}
#PageHint  {{ font-size: 9pt; color: {Palette.TEXT_MUTED}; }}

/* ---- Controls --------------------------------------------------------- */
QPushButton {{
    background: {Palette.PANEL_ALT};
    border: 1px solid {Palette.LINE};
    border-radius: 7px;
    padding: 8px 15px;
    color: {Palette.TEXT};
}}
QPushButton:hover {{ border-color: {Palette.LINE_LIGHT}; background: {Palette.LINE}; }}
QPushButton:pressed {{ background: {Palette.PANEL}; }}
QPushButton:disabled {{ color: {Palette.TEXT_DIM}; border-color: {Palette.LINE}; }}
QPushButton#Primary {{
    background: {Palette.ACCENT};
    border-color: {Palette.ACCENT};
    color: #1a1200;
    font-weight: 600;
}}
QPushButton#Primary:hover {{ background: {Palette.ACCENT_DARK}; }}
QPushButton#Danger {{ color: {Palette.DANGER}; border-color: rgba(248,113,113,0.35); }}
QPushButton#Ghost  {{ background: transparent; color: {Palette.TEXT_MUTED}; }}
QPushButton#Ghost:hover {{ color: {Palette.TEXT}; background: {Palette.PANEL_ALT}; }}

QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QComboBox {{
    background: {Palette.PANEL};
    border: 1px solid {Palette.LINE};
    border-radius: 7px;
    padding: 7px 9px;
    selection-background-color: {Palette.ACCENT};
    selection-color: #1a1200;
}}
QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus,
QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus {{
    border-color: {Palette.ACCENT};
}}
QComboBox::drop-down {{ border: none; width: 22px; }}
QComboBox QAbstractItemView {{
    background: {Palette.PANEL_ALT};
    border: 1px solid {Palette.LINE};
    selection-background-color: {Palette.ACCENT_SOFT};
    selection-color: {Palette.ACCENT};
    outline: none;
}}

QCheckBox {{ spacing: 9px; }}
QCheckBox::indicator {{
    width: 17px; height: 17px;
    border: 1px solid {Palette.LINE_LIGHT};
    border-radius: 4px;
    background: {Palette.PANEL};
}}
QCheckBox::indicator:checked {{
    background: {Palette.ACCENT};
    border-color: {Palette.ACCENT};
}}

/* ---- Tables ----------------------------------------------------------- */
QTableWidget, QTableView {{
    background: {Palette.PANEL};
    border: 1px solid {Palette.LINE};
    border-radius: 9px;
    gridline-color: {Palette.LINE};
    selection-background-color: {Palette.ACCENT_SOFT};
    selection-color: {Palette.TEXT};
}}
QHeaderView::section {{
    background: {Palette.PANEL_ALT};
    color: {Palette.TEXT_MUTED};
    border: none;
    border-bottom: 1px solid {Palette.LINE};
    padding: 9px 10px;
    font-size: 8.5pt;
    font-weight: 600;
}}
QTableWidget::item {{ padding: 7px 9px; border-bottom: 1px solid {Palette.LINE}; }}

/* ---- Scrollbars ------------------------------------------------------- */
QScrollBar:vertical {{ background: transparent; width: 11px; margin: 0; }}
QScrollBar::handle:vertical {{
    background: {Palette.LINE_LIGHT}; border-radius: 5px; min-height: 28px;
}}
QScrollBar::handle:vertical:hover {{ background: {Palette.TEXT_DIM}; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
QScrollBar:horizontal {{ background: transparent; height: 11px; }}
QScrollBar::handle:horizontal {{
    background: {Palette.LINE_LIGHT}; border-radius: 5px; min-width: 28px;
}}

QSplitter::handle {{ background: {Palette.LINE}; }}
QStatusBar {{
    background: {Palette.PANEL};
    border-top: 1px solid {Palette.LINE};
    color: {Palette.TEXT_MUTED};
}}
QToolTip {{
    background: {Palette.PANEL_ALT};
    color: {Palette.TEXT};
    border: 1px solid {Palette.LINE_LIGHT};
    padding: 6px 9px;
    border-radius: 6px;
}}
"""


def apply(app) -> None:
    """Apply the stylesheet and DPI-correct defaults to a QApplication."""
    app.setStyle("Fusion")
    app.setStyleSheet(STYLESHEET)

    from PyQt6.QtGui import QPalette
    pal = app.palette()
    pal.setColor(QPalette.ColorRole.Window, QColor(Palette.BG))
    pal.setColor(QPalette.ColorRole.WindowText, QColor(Palette.TEXT))
    pal.setColor(QPalette.ColorRole.Base, QColor(Palette.PANEL))
    pal.setColor(QPalette.ColorRole.Text, QColor(Palette.TEXT))
    pal.setColor(QPalette.ColorRole.Highlight, QColor(Palette.ACCENT))
    pal.setColor(QPalette.ColorRole.HighlightedText, QColor("#1a1200"))
    app.setPalette(pal)
