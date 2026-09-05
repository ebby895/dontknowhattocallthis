"""Main window: sidebar navigation, seven pages, live-updating stats."""

from __future__ import annotations

import csv
import sys
from pathlib import Path
from typing import Optional

from PyQt6.QtCore import QSize, Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QGuiApplication
from PyQt6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDoubleSpinBox, QFileDialog,
    QFormLayout, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QMainWindow, QMessageBox, QPushButton, QScrollArea,
    QSpinBox, QStackedWidget, QTableWidget, QTableWidgetItem, QTextEdit,
    QVBoxLayout, QWidget,
)

from ..config import Config
from ..core import Deal, format_age
from ..db import Store
from ..engine import Engine, EngineEvent
from .theme import Palette, apply as apply_theme, icon
from .widgets import BarChart, Card, FunnelChart, LineChart, StatTile, stat_row

NAV = [
    ("Dashboard",   "dashboard"),
    ("Deal Queue",  "queue"),
    ("Revenue",     "revenue"),
    ("Pipeline",    "pipeline"),
    ("Performance", "chart"),
    ("Timing",      "clock"),
    ("Settings",    "settings"),
]


def _page(title: str, hint: str = "") -> tuple[QWidget, QVBoxLayout]:
    """Scrollable page shell with a heading."""
    scroll = QScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setFrameShape(QScrollArea.Shape.NoFrame)

    inner = QWidget()
    layout = QVBoxLayout(inner)
    layout.setContentsMargins(24, 20, 24, 24)
    layout.setSpacing(14)

    heading = QLabel(title)
    heading.setObjectName("PageTitle")
    layout.addWidget(heading)

    if hint:
        sub = QLabel(hint)
        sub.setObjectName("PageHint")
        sub.setWordWrap(True)
        layout.addWidget(sub)

    scroll.setWidget(inner)
    return scroll, layout


class MainWindow(QMainWindow):
    engine_event = pyqtSignal(object)   # marshals engine callbacks onto the UI thread

    def __init__(self, config: Config, store: Store):
        super().__init__()
        self.config = config
        self.store = store
        self.engine = Engine(config, store, on_event=self.engine_event.emit)
        self.engine_event.connect(self._on_engine_event)

        self.setWindowTitle("NxtGen Deal Engine")
        self.setMinimumSize(1180, 780)
        self.setWindowIcon(icon("bolt", Palette.ACCENT, 32))

        self._build()
        self._refresh_all()

        # Stats refresh on a timer; the engine emits its own events for the log.
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._refresh_all)
        self._timer.start(5000)

    # =====================================================================
    # Layout
    # =====================================================================

    def _build(self) -> None:
        root = QWidget()
        outer = QVBoxLayout(root)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        outer.addWidget(self._banner())

        body = QWidget()
        row = QHBoxLayout(body)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)

        row.addWidget(self._sidebar())

        self.stack = QStackedWidget()
        for builder in (
            self._page_dashboard, self._page_queue, self._page_revenue,
            self._page_pipeline, self._page_performance, self._page_timing,
            self._page_settings,
        ):
            self.stack.addWidget(builder())
        row.addWidget(self.stack, 1)

        outer.addWidget(body, 1)
        self.setCentralWidget(root)
        self.statusBar().showMessage("Idle — engine stopped")

    def _banner(self) -> QWidget:
        """Title bar across the full width, above the sidebar and pages."""
        bar = QWidget()
        bar.setObjectName("Banner")
        bar.setFixedHeight(58)

        layout = QHBoxLayout(bar)
        layout.setContentsMargins(20, 0, 20, 0)

        title = QLabel("Eb's Price Glitch Command Center")
        title.setObjectName("BannerTitle")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title, 1)

        return bar

    def _sidebar(self) -> QWidget:
        panel = QWidget()
        panel.setObjectName("Sidebar")
        panel.setFixedWidth(212)

        col = QVBoxLayout(panel)
        col.setContentsMargins(0, 0, 0, 12)
        col.setSpacing(0)

        title = QLabel("NxtGen")
        title.setObjectName("SidebarTitle")
        col.addWidget(title)

        tag = QLabel(self.config.settings.associate_tag)
        tag.setObjectName("SidebarTag")
        col.addWidget(tag)
        self._tag_label = tag

        self.nav = QListWidget()
        self.nav.setObjectName("Nav")
        self.nav.setIconSize(QSize(18, 18))
        for label, ic in NAV:
            self.nav.addItem(QListWidgetItem(icon(ic, Palette.TEXT_MUTED, 18), label))
        self.nav.setCurrentRow(0)
        self.nav.currentRowChanged.connect(self._on_nav)
        col.addWidget(self.nav, 1)

        controls = QWidget()
        cl = QVBoxLayout(controls)
        cl.setContentsMargins(12, 8, 12, 0)
        cl.setSpacing(7)

        self.btn_engine = QPushButton(icon("play", "#1a1200", 17), "  Start engine")
        self.btn_engine.setObjectName("Primary")
        self.btn_engine.clicked.connect(self._toggle_engine)
        cl.addWidget(self.btn_engine)

        self.lbl_armed = QLabel()
        self.lbl_armed.setObjectName("StatSub")
        self.lbl_armed.setWordWrap(True)
        cl.addWidget(self.lbl_armed)

        col.addWidget(controls)
        return panel

    def _on_nav(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        for i in range(self.nav.count()):
            colour = Palette.ACCENT if i == index else Palette.TEXT_MUTED
            self.nav.item(i).setIcon(icon(NAV[i][1], colour, 18))
        self._refresh_all()

    # =====================================================================
    # Dashboard
    # =====================================================================

    def _page_dashboard(self) -> QWidget:
        page, layout = _page(
            "Dashboard",
            "Live state of the capture pipeline and what it has earned.",
        )

        self.tile_commission = StatTile("Commission · 30d", "$0.00", "", "StatAccent")
        self.tile_clicks     = StatTile("Clicks · 30d", "0")
        self.tile_epc        = StatTile("EPC", "$0.00", "per 100 clicks")
        self.tile_conv       = StatTile("Conversion", "0%", "orders / clicks")
        layout.addWidget(stat_row(self.tile_commission, self.tile_clicks,
                                  self.tile_epc, self.tile_conv))

        self.tile_posts_24h = StatTile("Posts · 24h", "0")
        self.tile_queued    = StatTile("In queue", "0", "awaiting review")
        self.tile_scanned   = StatTile("Scanned · 24h", "0", "timeline posts")
        self.tile_latency   = StatTile("Detect → post", "—", "median end to end", "StatOk")
        layout.addWidget(stat_row(self.tile_posts_24h, self.tile_queued,
                                  self.tile_scanned, self.tile_latency))

        funnel_card = Card("Capture funnel · 24h")
        self.dash_funnel = FunnelChart()
        funnel_card.add(self.dash_funnel)
        layout.addWidget(funnel_card)

        log_card = Card("Activity")
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        self.log.setMinimumHeight(190)
        log_card.add(self.log)
        layout.addWidget(log_card)

        layout.addStretch(1)
        return page

    # =====================================================================
    # Queue
    # =====================================================================

    def _page_queue(self) -> QWidget:
        page, layout = _page(
            "Deal Queue",
            "Captured deals whose link chain resolved to Amazon, ranked by "
            "freshness, discount depth and category commission rate.",
        )

        bar = QHBoxLayout()
        refresh = QPushButton(icon("refresh", Palette.TEXT, 16), "  Refresh")
        refresh.clicked.connect(self._refresh_queue)
        bar.addWidget(refresh)
        bar.addStretch(1)
        self.queue_count = QLabel("0 deals")
        self.queue_count.setObjectName("PageHint")
        bar.addWidget(self.queue_count)
        layout.addLayout(bar)

        self.queue_table = QTableWidget(0, 8)
        self.queue_table.setHorizontalHeaderLabels(
            ["ASIN", "Product", "Price", "Discount", "Code", "Age", "Source", "Status"]
        )
        self.queue_table.verticalHeader().setVisible(False)
        self.queue_table.setSelectionBehavior(
            QTableWidget.SelectionBehavior.SelectRows
        )
        self.queue_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.queue_table.setMinimumHeight(320)
        header = self.queue_table.horizontalHeader()
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.queue_table.itemSelectionChanged.connect(self._on_queue_selection)
        layout.addWidget(self.queue_table)

        draft_card = Card("Draft")
        self.draft_edit = QTextEdit()
        self.draft_edit.setMinimumHeight(150)
        self.draft_edit.textChanged.connect(self._validate_draft)
        draft_card.add(self.draft_edit)

        meta = QHBoxLayout()
        self.draft_meta = QLabel("—")
        self.draft_meta.setObjectName("StatSub")
        meta.addWidget(self.draft_meta)
        meta.addStretch(1)

        self.btn_post = QPushButton(icon("check", "#1a1200", 16), "  Post now")
        self.btn_post.setObjectName("Primary")
        self.btn_post.clicked.connect(self._post_selected)
        meta.addWidget(self.btn_post)

        btn_open = QPushButton(icon("external", Palette.TEXT, 16), "  Open listing")
        btn_open.clicked.connect(self._open_listing)
        meta.addWidget(btn_open)

        btn_dismiss = QPushButton(icon("x", Palette.DANGER, 16), "  Dismiss")
        btn_dismiss.setObjectName("Danger")
        btn_dismiss.clicked.connect(self._dismiss_selected)
        meta.addWidget(btn_dismiss)

        draft_card.add_layout(meta)
        layout.addWidget(draft_card)
        layout.addStretch(1)
        return page

    # =====================================================================
    # Revenue
    # =====================================================================

    def _page_revenue(self) -> QWidget:
        page, layout = _page(
            "Revenue",
            "Imported from the Amazon Associates report export. Below the "
            "Creators API sales threshold there is no API for this data.",
        )

        bar = QHBoxLayout()
        btn_import = QPushButton(icon("external", Palette.TEXT, 16),
                                 "  Import Associates CSV")
        btn_import.clicked.connect(self._import_earnings)
        bar.addWidget(btn_import)
        bar.addStretch(1)
        layout.addLayout(bar)

        self.rev_commission = StatTile("Commission", "$0.00", "", "StatAccent")
        self.rev_revenue    = StatTile("Order revenue", "$0.00")
        self.rev_orders     = StatTile("Orders", "0")
        self.rev_per_post   = StatTile("Per post", "$0.00", "commission / post")
        layout.addWidget(stat_row(self.rev_commission, self.rev_revenue,
                                  self.rev_orders, self.rev_per_post))

        daily = Card("Commission by day")
        self.rev_chart = LineChart()
        daily.add(self.rev_chart)
        layout.addWidget(daily)

        clicks = Card("Clicks by day")
        self.rev_clicks_chart = LineChart()
        clicks.add(self.rev_clicks_chart)
        layout.addWidget(clicks)

        layout.addStretch(1)
        return page

    # =====================================================================
    # Pipeline
    # =====================================================================

    def _page_pipeline(self) -> QWidget:
        page, layout = _page(
            "Pipeline",
            "Engine health: what was scanned, what resolved to Amazon, what "
            "was held back and why.",
        )

        self.pipe_scanned  = StatTile("Scanned · 24h", "0")
        self.pipe_hits     = StatTile("Amazon hits", "0", "", "StatOk")
        self.pipe_hit_rate = StatTile("Hit rate", "0%", "of resolved links")
        self.pipe_latency  = StatTile("Avg latency", "—", "detect → post")
        layout.addWidget(stat_row(self.pipe_scanned, self.pipe_hits,
                                  self.pipe_hit_rate, self.pipe_latency))

        funnel = Card("Funnel")
        self.pipe_funnel = FunnelChart()
        funnel.add(self.pipe_funnel)
        layout.addWidget(funnel)

        holds = Card("Why deals were held")
        self.pipe_holds = BarChart()
        holds.add(self.pipe_holds)
        layout.addWidget(holds)

        rejects = Card("Rejected destinations (not Amazon)")
        self.pipe_rejects = BarChart()
        rejects.add(self.pipe_rejects)
        layout.addWidget(rejects)

        layout.addStretch(1)
        return page

    # =====================================================================
    # Performance
    # =====================================================================

    def _page_performance(self) -> QWidget:
        page, layout = _page(
            "Performance",
            "Which categories, discount depths, mechanics and source accounts "
            "actually pay.",
        )

        cat = Card("Commission by category")
        self.perf_category = BarChart()
        cat.add(self.perf_category)
        layout.addWidget(cat)

        disc = Card("Orders by discount depth")
        self.perf_discount = BarChart()
        disc.add(self.perf_discount)
        layout.addWidget(disc)

        mech = Card("Commission by deal mechanic")
        self.perf_mechanic = BarChart()
        mech.add(self.perf_mechanic)
        layout.addWidget(mech)

        src = Card("Best source accounts")
        self.perf_source = BarChart()
        src.add(self.perf_source)
        layout.addWidget(src)

        layout.addStretch(1)
        return page

    # =====================================================================
    # Timing
    # =====================================================================

    def _page_timing(self) -> QWidget:
        page, layout = _page(
            "Timing",
            "When to fire, and how fast a deal's value decays after it is posted.",
        )

        hour = Card("Engagement by hour posted (UTC)")
        self.time_hour = LineChart()
        hour.add(self.time_hour)
        layout.addWidget(hour)

        fresh = Card("Orders by deal age at time of posting")
        self.time_freshness = BarChart()
        fresh.add(self.time_freshness)
        layout.addWidget(fresh)

        volume = Card("Posts by hour")
        self.time_volume = BarChart()
        volume.add(self.time_volume)
        layout.addWidget(volume)

        source = Card("Engagement: AI copy vs template")
        self.time_source = BarChart()
        source.add(self.time_source)
        layout.addWidget(source)

        layout.addStretch(1)
        return page

    # =====================================================================
    # Settings
    # =====================================================================

    def _page_settings(self) -> QWidget:
        page, layout = _page("Settings")
        s = self.config.settings

        # --- secrets -----------------------------------------------------
        secrets = Card("API keys")
        form = QFormLayout()
        form.setSpacing(9)

        self.in_gemini = QLineEdit()
        self.in_gemini.setEchoMode(QLineEdit.EchoMode.Password)
        existing = self.config.gemini_key
        self.in_gemini.setPlaceholderText(
            f"Saved ({existing[:6]}…{existing[-4:]})" if existing else "AQ.…"
        )
        form.addRow("Gemini key", self._key_row(self.in_gemini, "gemini"))

        self.in_keepa = QLineEdit()
        self.in_keepa.setEchoMode(QLineEdit.EchoMode.Password)
        self.in_keepa.setPlaceholderText(
            "Saved" if self.config.keepa_key else "optional — verifies real discounts"
        )
        form.addRow("Keepa key", self._key_row(self.in_keepa, "keepa"))
        secrets.add_layout(form)

        note = QLabel(
            "Stored in the OS credential manager, never in a file. Entered once — "
            "they persist across restarts. If a key has ever appeared in a "
            "screenshot or a commit, revoke it and paste a fresh one."
            if self.config.keyring_available()
            else "keyring is not installed, so keys cannot be stored securely. "
                 "Run: pip install keyring"
        )
        note.setObjectName("StatSub")
        note.setWordWrap(True)
        secrets.add(note)

        save_keys = QPushButton("Save keys")
        save_keys.setObjectName("Primary")
        save_keys.clicked.connect(self._save_keys)
        secrets.add(save_keys)
        layout.addWidget(secrets)

        # --- amazon ------------------------------------------------------
        amazon = Card("Amazon")
        af = QFormLayout()
        self.in_tag = QLineEdit(s.associate_tag)
        af.addRow("Associate tag", self.in_tag)
        amazon.add_layout(af)
        layout.addWidget(amazon)

        # --- autopilot ---------------------------------------------------
        auto = Card("Autopilot")
        self.chk_armed = QCheckBox("Armed — publish without review")
        self.chk_armed.setChecked(s.autopost_armed)
        self.chk_armed.stateChanged.connect(self._update_armed_label)
        auto.add(self.chk_armed)

        warn = QLabel(
            "When armed, only deals clearing every gate publish: exactly one "
            "Amazon link carrying your tag, an #ad disclosure, inside the "
            "character limit, fresh enough, with a verified discount or a "
            "captured code, and within the rate caps. Everything else queues."
        )
        warn.setObjectName("StatSub")
        warn.setWordWrap(True)
        auto.add(warn)

        gf = QFormLayout()
        gf.setSpacing(9)

        self.in_max_age = QSpinBox(); self.in_max_age.setRange(5, 720)
        self.in_max_age.setValue(s.max_deal_age_minutes)
        gf.addRow("Max deal age (min)", self.in_max_age)

        self.in_gap = QSpinBox(); self.in_gap.setRange(1, 240)
        self.in_gap.setValue(s.min_gap_minutes)
        gf.addRow("Min gap between posts (min)", self.in_gap)

        self.in_per_hour = QSpinBox(); self.in_per_hour.setRange(1, 30)
        self.in_per_hour.setValue(s.max_posts_per_hour)
        gf.addRow("Max posts / hour", self.in_per_hour)

        self.in_per_day = QSpinBox(); self.in_per_day.setRange(1, 300)
        self.in_per_day.setValue(s.max_posts_per_day)
        gf.addRow("Max posts / day", self.in_per_day)

        self.in_min_disc = QDoubleSpinBox(); self.in_min_disc.setRange(0, 95)
        self.in_min_disc.setValue(s.min_discount_pct)
        gf.addRow("Min discount %", self.in_min_disc)

        self.in_interval = QDoubleSpinBox(); self.in_interval.setRange(1.0, 120.0)
        self.in_interval.setValue(s.scan_interval_seconds)
        gf.addRow("Scan interval (s)", self.in_interval)

        self.in_input_mode = QComboBox()
        self.in_input_mode.addItems(["playwright", "keyboard"])
        self.in_input_mode.setCurrentText(s.input_mode)
        gf.addRow("Input mode", self.in_input_mode)

        self.in_model = QLineEdit(s.gemini_model)
        gf.addRow("Gemini model", self.in_model)

        auto.add_layout(gf)

        self.chk_ai = QCheckBox("Use Gemini for copy (falls back to templates)")
        self.chk_ai.setChecked(s.ai_enabled)
        auto.add(self.chk_ai)

        self.chk_long = QCheckBox("X Premium account (posts over 280 characters)")
        self.chk_long.setChecked(s.long_form_posts)
        auto.add(self.chk_long)

        self.chk_headless = QCheckBox("Run browser headless")
        self.chk_headless.setChecked(s.headless)
        auto.add(self.chk_headless)

        save = QPushButton("Save settings")
        save.setObjectName("Primary")
        save.clicked.connect(self._save_settings)
        auto.add(save)
        layout.addWidget(auto)

        layout.addStretch(1)
        self._update_armed_label()
        return page

    # =====================================================================
    # Actions
    # =====================================================================

    def _toggle_engine(self) -> None:
        if self.engine.running:
            self.engine.stop()
            self.btn_engine.setText("  Start engine")
            self.btn_engine.setIcon(icon("play", "#1a1200", 17))
            self.statusBar().showMessage("Idle — engine stopped")
            self._append_log("Engine stopped")
        else:
            self.engine.start()
            self.btn_engine.setText("  Stop engine")
            self.btn_engine.setIcon(icon("stop", "#1a1200", 17))
            self.statusBar().showMessage("Engine starting…")
            self._append_log("Engine starting")

    def _update_armed_label(self) -> None:
        armed = getattr(self, "chk_armed", None)
        is_armed = armed.isChecked() if armed else self.config.settings.autopost_armed
        if is_armed:
            self.lbl_armed.setText("⚡ Armed — posts publish unattended")
            self.lbl_armed.setStyleSheet(f"color: {Palette.WARN};")
        else:
            self.lbl_armed.setText("Review mode — nothing posts on its own")
            self.lbl_armed.setStyleSheet(f"color: {Palette.TEXT_DIM};")

    def _key_row(self, field: QLineEdit, kind: str) -> QWidget:
        """A key field with a 'from file…' button beside it.

        Typing a long key into a password field is where people get stuck, and
        pasting one into a chat window is how keys leak. This reads the file the
        user already saved, locally.
        """
        holder = QWidget()
        row = QHBoxLayout(holder)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(6)
        row.addWidget(field, 1)

        browse = QPushButton(icon("external", Palette.TEXT, 15), "  From file…")
        browse.setToolTip("Pick the .txt file containing the key")
        browse.clicked.connect(lambda: self._load_key_from_file(kind))
        row.addWidget(browse)

        return holder

    def _load_key_from_file(self, kind: str) -> None:
        from ..keyfile import read_key_file, shred

        label = "Gemini" if kind == "gemini" else "Keepa"
        path, _ = QFileDialog.getOpenFileName(
            self, f"Select the file containing your {label} key", "",
            "Text files (*.txt *.env *.key);;All files (*)",
        )
        if not path:
            return

        result = read_key_file(path, kind)
        if not result.ok:
            QMessageBox.warning(self, "Could not read the key", result.reason)
            return

        secret_name = "gemini_api_key" if kind == "gemini" else "keepa_api_key"
        if not self.config.set_secret(secret_name, result.key):
            QMessageBox.critical(
                self, "Not saved",
                "The key was read but could not be stored. Install keyring:\n\n"
                "    pip install keyring",
            )
            return

        field = self.in_gemini if kind == "gemini" else self.in_keepa
        field.clear()
        field.setPlaceholderText(f"Saved ({result.masked})")

        # A key in a plaintext file is the risk we are trying to remove, so
        # offer to clear it now while the user is here.
        answer = QMessageBox.question(
            self, f"{label} key saved",
            f"Saved {result.masked} to the credential manager.\n"
            "You will not need to enter it again.\n\n"
            f"Delete the file now?\n{Path(path).name}\n\n"
            "Leaving a key in a plaintext file is the main way they leak.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes,
        )

        if answer == QMessageBox.StandardButton.Yes:
            ok, reason = shred(path)
            if ok:
                self.statusBar().showMessage(
                    f"{label} key saved; source file deleted", 6000
                )
            else:
                QMessageBox.warning(
                    self, "File not deleted",
                    f"The key is saved, but the file could not be removed:\n{reason}\n\n"
                    "Delete it by hand when you can.",
                )
        else:
            self.statusBar().showMessage(f"{label} key saved", 5000)

    def _save_keys(self) -> None:
        saved = []
        if self.in_gemini.text().strip():
            if self.config.set_secret("gemini_api_key", self.in_gemini.text().strip()):
                saved.append("Gemini")
                self.in_gemini.clear()
        if self.in_keepa.text().strip():
            if self.config.set_secret("keepa_api_key", self.in_keepa.text().strip()):
                saved.append("Keepa")
                self.in_keepa.clear()

        if saved:
            QMessageBox.information(
                self, "Saved",
                f"{' and '.join(saved)} stored in the OS credential manager.\n"
                "You will not need to enter them again.",
            )
        else:
            QMessageBox.warning(
                self, "Not saved",
                "Nothing was saved. Enter a key, and make sure keyring is "
                "installed (pip install keyring).",
            )

    def _save_settings(self) -> None:
        self.config.update(
            associate_tag=self.in_tag.text().strip() or "nxtgenhotdeal-20",
            autopost_armed=self.chk_armed.isChecked(),
            max_deal_age_minutes=self.in_max_age.value(),
            min_gap_minutes=self.in_gap.value(),
            max_posts_per_hour=self.in_per_hour.value(),
            max_posts_per_day=self.in_per_day.value(),
            min_discount_pct=self.in_min_disc.value(),
            scan_interval_seconds=self.in_interval.value(),
            input_mode=self.in_input_mode.currentText(),
            gemini_model=self.in_model.text().strip() or "gemini-2.5-flash",
            ai_enabled=self.chk_ai.isChecked(),
            long_form_posts=self.chk_long.isChecked(),
            headless=self.chk_headless.isChecked(),
        )
        self._tag_label.setText(self.config.settings.associate_tag)
        self._update_armed_label()
        self.statusBar().showMessage("Settings saved", 4000)

    def _import_earnings(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Import Associates report", "", "CSV files (*.csv);;All files (*)"
        )
        if not path:
            return

        # Associates exports vary by report type, so match headers loosely.
        aliases = {
            "date": ["date", "day"],
            "asin": ["asin", "asin/isbn"],
            "product_title": ["title", "product name", "name"],
            "category": ["category", "product category"],
            "clicks": ["clicks"],
            "ordered_items": ["items ordered", "ordered items", "orders"],
            "shipped_items": ["items shipped", "shipped items"],
            "revenue": ["revenue", "product revenue", "ordered revenue"],
            "commission": ["earnings", "commission", "ad fees", "fees"],
        }

        rows = []
        try:
            with open(path, newline="", encoding="utf-8-sig") as fh:
                for raw in csv.DictReader(fh):
                    lowered = {(k or "").strip().lower(): v for k, v in raw.items()}
                    row = {}
                    for field, names in aliases.items():
                        for n in names:
                            if n in lowered and lowered[n] not in (None, ""):
                                row[field] = _clean_number(lowered[n]) \
                                    if field in ("clicks", "ordered_items",
                                                 "shipped_items", "revenue",
                                                 "commission") else lowered[n]
                                break
                    if row.get("date"):
                        rows.append(row)
        except Exception as exc:
            QMessageBox.critical(self, "Import failed", str(exc))
            return

        n = self.store.import_earnings(rows)
        QMessageBox.information(self, "Imported", f"{n} rows imported.")
        self._refresh_all()

    # --- queue -----------------------------------------------------------

    def _selected_deal(self) -> Optional[dict]:
        rows = self.queue_table.selectionModel().selectedRows()
        if not rows:
            return None
        item = self.queue_table.item(rows[0].row(), 0)
        return item.data(Qt.ItemDataRole.UserRole) if item else None

    def _on_queue_selection(self) -> None:
        row = self._selected_deal()
        if not row:
            return
        from .. import copywriter
        deal = _row_to_deal(row)
        draft = copywriter.generate(
            deal, self.config.settings.associate_tag,
            long_form=self.config.settings.long_form_posts,
        )
        self.draft_edit.setPlainText(draft.text)

    def _validate_draft(self) -> None:
        import re
        from ..core import is_amazon_url
        from .. import copywriter

        text = self.draft_edit.toPlainText()
        n = copywriter.char_count(text)
        urls = re.findall(r"https?://\S+", text)

        checks = []
        checks.append(("#ad" in text, "disclosure"))
        checks.append((len(urls) == 1 and is_amazon_url(urls[0]), "Amazon link"))
        checks.append((self.config.settings.associate_tag in text, "tag"))
        checks.append((n <= 280 or self.config.settings.long_form_posts, "length"))

        parts = [f"{n}/280"]
        for ok, name in checks:
            parts.append(("✓ " if ok else "✗ ") + name)

        all_ok = all(ok for ok, _ in checks)
        self.draft_meta.setText("   ".join(parts))
        self.draft_meta.setStyleSheet(
            f"color: {Palette.OK if all_ok else Palette.DANGER};"
        )
        self.btn_post.setEnabled(all_ok)

    def _post_selected(self) -> None:
        row = self._selected_deal()
        if not row:
            return
        if not self.engine.running:
            QMessageBox.warning(self, "Engine not running",
                                "Start the engine first — posting needs the browser.")
            return

        deal = _row_to_deal(row)
        text = self.draft_edit.toPlainText()

        def done(ok: bool, reason: str) -> None:
            self._append_log(f"Posted {deal.asin}" if ok
                             else f"Post failed for {deal.asin}: {reason}")
            self._refresh_queue()

        self.engine.post_now(deal, text, on_done=done)
        self.statusBar().showMessage(f"Posting {deal.asin}…", 5000)

    def _open_listing(self) -> None:
        row = self._selected_deal()
        if not row:
            return
        import webbrowser
        webbrowser.open(row["affiliate_url"])

    def _dismiss_selected(self) -> None:
        row = self._selected_deal()
        if not row:
            return
        self.store.update_deal(row["asin"], status="dismissed")
        self._refresh_queue()

    # =====================================================================
    # Refresh
    # =====================================================================

    def _on_engine_event(self, event: EngineEvent) -> None:
        if event.kind == "status":
            self.statusBar().showMessage(event.message)
        self._append_log(event.message)
        if event.kind in ("posted", "deal", "held"):
            self._refresh_queue()

    def _append_log(self, message: str) -> None:
        if not message:
            return
        from datetime import datetime
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log.append(f"<span style='color:{Palette.TEXT_DIM}'>{stamp}</span>  {message}")

    def _refresh_all(self) -> None:
        try:
            self._refresh_dashboard()
            self._refresh_queue()
            self._refresh_revenue()
            self._refresh_pipeline()
            self._refresh_performance()
            self._refresh_timing()
        except Exception:
            pass

    def _refresh_dashboard(self) -> None:
        s = self.store.summary()
        self.tile_commission.set(f"${s['commission_30d']:.2f}",
                                 f"{s['orders_30d']} orders")
        self.tile_clicks.set(str(s["clicks_30d"]))
        self.tile_epc.set(f"${s['epc']:.2f}")
        self.tile_conv.set(f"{s['conversion_pct']:.1f}%")
        self.tile_posts_24h.set(str(s["posts_24h"]), f"{s['posts_1h']} in the last hour")
        self.tile_queued.set(str(s["queued"]))
        self.tile_scanned.set(str(s["scanned_24h"]), f"{s['hit_rate_pct']}% hit rate")
        self.tile_latency.set(
            f"{s['latency_avg_ms'] / 1000:.1f}s" if s["latency_avg_ms"] else "—"
        )

        p = self.store.pipeline_stats(24)
        self.dash_funnel.set_data([
            ("Scanned", p["scanned"]), ("Resolved", p["resolved"]),
            ("Amazon", p["amazon_hits"]), ("Queued", p["queued"]),
            ("Posted", p["posted"]),
        ])

    def _refresh_queue(self) -> None:
        rows = self.store.queue(200)
        self.queue_count.setText(f"{len(rows)} deals")
        self.queue_table.setRowCount(len(rows))

        for i, r in enumerate(rows):
            d = dict(r)
            cells = [
                d["asin"],
                (d.get("title") or d.get("source_text") or "")[:70],
                f"${d['current_price']:.2f}" if d.get("current_price") else "—",
                f"{d['discount_pct']:.0f}%" if d.get("discount_pct") else "—",
                d.get("promo_code") or "—",
                format_age(_age(d.get("posted_at"))),
                d.get("source_author") or "—",
                d.get("hold_reason") or d.get("status") or "",
            ]
            for col, text in enumerate(cells):
                item = QTableWidgetItem(str(text))
                if col == 0:
                    item.setData(Qt.ItemDataRole.UserRole, d)
                self.queue_table.setItem(i, col, item)

    def _refresh_revenue(self) -> None:
        r = self.store.revenue_stats(30)
        self.rev_commission.set(f"${r['commission']:.2f}", f"last {r['days']} days")
        self.rev_revenue.set(f"${r['revenue']:.2f}")
        self.rev_orders.set(str(r["orders"]), f"{r['conversion_pct']:.1f}% conversion")
        self.rev_per_post.set(f"${r['commission_per_post']:.2f}",
                              f"over {r['posts']} posts")

        daily = self.store.revenue_by_day(30)
        self.rev_chart.set_data(
            [(d["date"][5:], float(d["commission"] or 0)) for d in daily],
            Palette.ACCENT,
        )
        self.rev_clicks_chart.set_data(
            [(d["date"][5:], float(d["clicks"] or 0)) for d in daily],
            Palette.INFO,
        )

    def _refresh_pipeline(self) -> None:
        p = self.store.pipeline_stats(24)
        self.pipe_scanned.set(str(p["scanned"]))
        self.pipe_hits.set(str(p["amazon_hits"]), f"{p['rejected']} rejected")
        self.pipe_hit_rate.set(f"{p['hit_rate_pct']}%")
        self.pipe_latency.set(
            f"{p['latency_avg_ms'] / 1000:.1f}s" if p["latency_avg_ms"] else "—"
        )

        self.pipe_funnel.set_data([
            ("Scanned", p["scanned"]), ("Resolved", p["resolved"]),
            ("Amazon", p["amazon_hits"]), ("Queued", p["queued"]),
            ("Posted", p["posted"]),
        ])
        self.pipe_holds.set_data([(r[:26], n) for r, n in p["hold_reasons"]])
        self.pipe_rejects.set_data(p["rejected_hosts"])

    def _refresh_performance(self) -> None:
        perf = self.store.performance_stats(30)
        self.perf_category.set_data(
            [(r["category"] or "unknown", float(r["commission"] or 0))
             for r in perf["by_category"]][:10], " $"
        )
        self.perf_discount.set_data(
            [(r["band"], float(r["orders"] or 0)) for r in perf["by_discount"]]
        )
        self.perf_mechanic.set_data(
            [(r["mechanic"] or "deal", float(r["commission"] or 0))
             for r in perf["by_mechanic"]][:10], " $"
        )
        self.perf_source.set_data(
            [(r["source_author"] or "unknown", float(r["deals"] or 0))
             for r in perf["by_source"]][:10]
        )

    def _refresh_timing(self) -> None:
        t = self.store.timing_stats(30)
        by_hour = {int(r["hour"]): r for r in t["by_hour"]}
        self.time_hour.set_data(
            [(f"{h:02d}", float((by_hour.get(h) or {}).get("avg_engagement") or 0))
             for h in range(24)],
            Palette.SERIES[2],
        )
        self.time_volume.set_data(
            [(f"{int(r['hour']):02d}:00", float(r["posts"])) for r in t["by_hour"]]
        )
        self.time_freshness.set_data(
            [(r["band"], float(r["orders"] or 0)) for r in t["by_freshness"]]
        )
        self.time_source.set_data(
            [(r["copy_source"] or "template", float(r["avg_engagement"] or 0))
             for r in t["by_copy_source"]]
        )

    def closeEvent(self, event) -> None:
        if self.engine.running:
            self.engine.stop()
        self.store.close()
        super().closeEvent(event)


# --- helpers -------------------------------------------------------------

def _age(iso: Optional[str]) -> Optional[int]:
    from ..core import age_minutes
    return age_minutes(iso)


def _clean_number(v: str) -> float:
    try:
        return float(str(v).replace("$", "").replace(",", "").replace("%", "").strip())
    except (ValueError, AttributeError):
        return 0.0


def _row_to_deal(row: dict) -> Deal:
    import json
    return Deal(
        asin=row["asin"],
        affiliate_url=row["affiliate_url"],
        source_post_id=row.get("source_post_id") or "",
        source_author=row.get("source_author") or "",
        source_text=row.get("source_text") or "",
        posted_at=row.get("posted_at"),
        promo_code=row.get("promo_code"),
        mechanic=row.get("mechanic") or "deal",
        prices_in_post=json.loads(row.get("prices_in_post") or "[]"),
        title=row.get("title"),
        current_price=row.get("current_price"),
        reference_price=row.get("reference_price"),
        discount_pct=row.get("discount_pct"),
        available=None if row.get("available") is None else bool(row["available"]),
        category=row.get("category"),
    )


def run() -> int:
    # Must be set before the QApplication exists, or Windows scaling is wrong.
    QGuiApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    app = QApplication(sys.argv)
    app.setApplicationName("NxtGen Deal Engine")
    apply_theme(app)

    config = Config()
    store = Store(config.settings.db_path)

    window = MainWindow(config, store)
    window.show()
    return app.exec()
