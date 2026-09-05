"""Reusable UI pieces: stat tiles, cards, and the charts the stats pages use.

Charts are painted with QPainter rather than pulled from a plotting library, so
the app has no extra runtime dependency and the visuals match the palette
exactly.
"""

from __future__ import annotations

from typing import Optional, Sequence

from PyQt6.QtCore import QRectF, Qt
from PyQt6.QtGui import QBrush, QColor, QFont, QPainter, QPen, QPolygonF
from PyQt6.QtCore import QPointF
from PyQt6.QtWidgets import (
    QFrame, QHBoxLayout, QLabel, QSizePolicy, QVBoxLayout, QWidget,
)

from .theme import Palette


class Card(QFrame):
    """A titled panel. Everything on the stats pages sits in one of these."""

    def __init__(self, title: str = "", parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.setObjectName("Card")
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(16, 14, 16, 16)
        self._layout.setSpacing(10)

        if title:
            label = QLabel(title.upper())
            label.setObjectName("CardTitle")
            self._layout.addWidget(label)

    def add(self, widget: QWidget, stretch: int = 0) -> QWidget:
        self._layout.addWidget(widget, stretch)
        return widget

    def add_layout(self, layout) -> None:
        self._layout.addLayout(layout)


class StatTile(Card):
    """Headline number with a label underneath."""

    def __init__(self, title: str, value: str = "—", sub: str = "",
                 style: str = "StatValue", parent: Optional[QWidget] = None):
        super().__init__(title, parent)
        self.value_label = QLabel(value)
        self.value_label.setObjectName(style)
        self.add(self.value_label)

        self.sub_label = QLabel(sub)
        self.sub_label.setObjectName("StatSub")
        self.sub_label.setWordWrap(True)
        self.add(self.sub_label)

        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

    def set(self, value: str, sub: Optional[str] = None) -> None:
        self.value_label.setText(value)
        if sub is not None:
            self.sub_label.setText(sub)


class BarChart(QWidget):
    """Horizontal bars, for ranked categorical data.

    Reads better than vertical bars when the labels are names (categories,
    source accounts, hold reasons) rather than a time axis.
    """

    def __init__(self, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self._data: list[tuple[str, float]] = []
        self._suffix = ""
        self.setMinimumHeight(180)

    def set_data(self, data: Sequence[tuple[str, float]], suffix: str = "") -> None:
        self._data = list(data)
        self._suffix = suffix
        self.update()

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        if not self._data:
            p.setPen(QColor(Palette.TEXT_DIM))
            p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "No data yet")
            return

        peak = max((v for _, v in self._data), default=0) or 1
        row_h = min(34, max(22, self.height() // max(1, len(self._data))))
        label_w = 132
        value_w = 74
        bar_x = label_w + 8
        bar_w = max(30, self.width() - bar_x - value_w)

        font = QFont(self.font())
        font.setPointSizeF(9.0)
        p.setFont(font)

        for i, (label, value) in enumerate(self._data):
            y = i * row_h
            if y + row_h > self.height():
                break

            p.setPen(QColor(Palette.TEXT_MUTED))
            p.drawText(
                QRectF(0, y, label_w, row_h),
                Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                _elide(label, 20),
            )

            track = QRectF(bar_x, y + row_h * 0.28, bar_w, row_h * 0.44)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QBrush(QColor(Palette.PANEL_ALT)))
            p.drawRoundedRect(track, 4, 4)

            filled = bar_w * (value / peak)
            if filled > 1:
                colour = QColor(Palette.SERIES[i % len(Palette.SERIES)])
                p.setBrush(QBrush(colour))
                p.drawRoundedRect(
                    QRectF(bar_x, y + row_h * 0.28, filled, row_h * 0.44), 4, 4
                )

            p.setPen(QColor(Palette.TEXT))
            p.drawText(
                QRectF(bar_x + bar_w + 8, y, value_w - 8, row_h),
                Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                _fmt(value) + self._suffix,
            )


class LineChart(QWidget):
    """Time series with a filled area, for daily revenue and hourly activity."""

    def __init__(self, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self._points: list[tuple[str, float]] = []
        self._colour = Palette.ACCENT
        self.setMinimumHeight(200)

    def set_data(self, points: Sequence[tuple[str, float]],
                 colour: str = Palette.ACCENT) -> None:
        self._points = list(points)
        self._colour = colour
        self.update()

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        if len(self._points) < 2:
            p.setPen(QColor(Palette.TEXT_DIM))
            p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter,
                       "Not enough data to plot yet")
            return

        pad_l, pad_r, pad_t, pad_b = 46, 12, 14, 26
        w = self.width() - pad_l - pad_r
        h = self.height() - pad_t - pad_b
        peak = max(v for _, v in self._points) or 1
        step = w / (len(self._points) - 1)

        # Gridlines and y labels, so the shape is readable as magnitude.
        p.setPen(QPen(QColor(Palette.LINE), 1))
        font = QFont(self.font())
        font.setPointSizeF(8.0)
        p.setFont(font)
        for i in range(5):
            y = pad_t + h - (h * i / 4)
            p.setPen(QPen(QColor(Palette.LINE), 1, Qt.PenStyle.DotLine))
            p.drawLine(int(pad_l), int(y), int(pad_l + w), int(y))
            p.setPen(QColor(Palette.TEXT_DIM))
            p.drawText(QRectF(0, y - 9, pad_l - 6, 18),
                       Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
                       _fmt(peak * i / 4))

        pts = [
            QPointF(pad_l + i * step, pad_t + h - (h * (v / peak)))
            for i, (_, v) in enumerate(self._points)
        ]

        area = QPolygonF(pts + [QPointF(pts[-1].x(), pad_t + h),
                                QPointF(pts[0].x(), pad_t + h)])
        fill = QColor(self._colour)
        fill.setAlpha(38)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(fill))
        p.drawPolygon(area)

        p.setPen(QPen(QColor(self._colour), 2))
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawPolyline(QPolygonF(pts))

        p.setBrush(QBrush(QColor(self._colour)))
        for pt in pts:
            p.drawEllipse(pt, 2.6, 2.6)

        # First and last x labels only; a dense axis is noise at this size.
        p.setPen(QColor(Palette.TEXT_DIM))
        p.drawText(QRectF(pad_l, pad_t + h + 4, 90, 18),
                   Qt.AlignmentFlag.AlignLeft, _elide(self._points[0][0], 12))
        p.drawText(QRectF(pad_l + w - 90, pad_t + h + 4, 90, 18),
                   Qt.AlignmentFlag.AlignRight, _elide(self._points[-1][0], 12))


class FunnelChart(QWidget):
    """Stage-by-stage pipeline funnel with drop-off percentages."""

    def __init__(self, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self._stages: list[tuple[str, int]] = []
        self.setMinimumHeight(190)

    def set_data(self, stages: Sequence[tuple[str, int]]) -> None:
        self._stages = list(stages)
        self.update()

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        if not self._stages:
            p.setPen(QColor(Palette.TEXT_DIM))
            p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "No activity yet")
            return

        top = max((v for _, v in self._stages), default=0) or 1
        row_h = max(26, self.height() // max(1, len(self._stages)))
        label_w = 116

        font = QFont(self.font())
        font.setPointSizeF(9.0)
        p.setFont(font)

        for i, (name, count) in enumerate(self._stages):
            y = i * row_h
            if y + row_h > self.height():
                break

            p.setPen(QColor(Palette.TEXT_MUTED))
            p.drawText(QRectF(0, y, label_w, row_h),
                       Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, name)

            avail = self.width() - label_w - 96
            width = max(2.0, avail * (count / top))
            colour = QColor(Palette.SERIES[i % len(Palette.SERIES)])

            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QBrush(colour))
            p.drawRoundedRect(
                QRectF(label_w, y + row_h * 0.22, width, row_h * 0.56), 5, 5
            )

            p.setPen(QColor(Palette.TEXT))
            p.drawText(QRectF(label_w + width + 8, y, 60, row_h),
                       Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                       str(count))

            # Conversion against the previous stage is the number that matters.
            if i > 0:
                prev = self._stages[i - 1][1]
                pct = (count / prev * 100) if prev else 0
                p.setPen(QColor(Palette.TEXT_DIM))
                p.drawText(QRectF(self.width() - 52, y, 48, row_h),
                           Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
                           f"{pct:.0f}%")


def stat_row(*tiles: StatTile) -> QWidget:
    """Lay tiles out in an evenly spaced row."""
    holder = QWidget()
    layout = QHBoxLayout(holder)
    layout.setContentsMargins(0, 0, 0, 0)
    layout.setSpacing(12)
    for t in tiles:
        layout.addWidget(t)
    return holder


def _fmt(v: float) -> str:
    if v >= 1_000_000:
        return f"{v / 1_000_000:.1f}M"
    if v >= 1_000:
        return f"{v / 1_000:.1f}k"
    if v == int(v):
        return str(int(v))
    return f"{v:.2f}"


def _elide(s: str, n: int) -> str:
    s = s or "—"
    return s if len(s) <= n else s[: n - 1] + "…"
