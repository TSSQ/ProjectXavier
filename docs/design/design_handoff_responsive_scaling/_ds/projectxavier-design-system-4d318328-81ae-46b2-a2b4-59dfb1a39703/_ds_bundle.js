/* @ds-bundle: {"format":4,"namespace":"ProjectXavierDesignSystem_4d3183","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"ICON_NAMES","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"ListRow","sourcePath":"components/core/ListRow.jsx"},{"name":"SectionLabel","sourcePath":"components/core/SectionLabel.jsx"},{"name":"AccountRow","sourcePath":"components/data/AccountRow.jsx"},{"name":"MiniBarChart","sourcePath":"components/data/MiniBarChart.jsx"},{"name":"StatTile","sourcePath":"components/data/StatTile.jsx"},{"name":"TransactionRow","sourcePath":"components/data/TransactionRow.jsx"},{"name":"Bubble","sourcePath":"components/feedback/Bubble.jsx"},{"name":"XavierAvatar","sourcePath":"components/feedback/XavierAvatar.jsx"},{"name":"XAVIER_LOOKS","sourcePath":"components/feedback/XavierAvatar.jsx"},{"name":"Pill","sourcePath":"components/forms/Pill.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},{"name":"TextField","sourcePath":"components/forms/TextField.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"c47998c3de8d","components/core/Button.jsx":"3c6c60013421","components/core/Card.jsx":"54aeef295c6b","components/core/Icon.jsx":"5fe5ba26322a","components/core/IconButton.jsx":"9e6ccc0bdd50","components/core/ListRow.jsx":"ac6e45914195","components/core/SectionLabel.jsx":"28c1cc657a8b","components/data/AccountRow.jsx":"24f365800960","components/data/MiniBarChart.jsx":"c9265df54942","components/data/StatTile.jsx":"7fc3b64d4993","components/data/TransactionRow.jsx":"f4ca935c144a","components/feedback/Bubble.jsx":"d45a25595f56","components/feedback/XavierAvatar.jsx":"d5bb79605b4c","components/forms/Pill.jsx":"d441fa96648a","components/forms/SegmentedControl.jsx":"d0dd4d2fddf5","components/forms/TextField.jsx":"8aa7c8abf30a","ui_kits/projectxavier-app/AssistantScreen.jsx":"dc787fc46748","ui_kits/projectxavier-app/DashboardScreen.jsx":"f87b518df1c3","ui_kits/projectxavier-app/PhoneFrame.jsx":"3b94b3767d3a","ui_kits/projectxavier-app/SettingsScreen.jsx":"62a08db4db56","ui_kits/projectxavier-app/TransactionsScreen.jsx":"f816c7be92df","ui_kits/projectxavier-app/data.js":"565a0e0b0f4e"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ProjectXavierDesignSystem_4d3183 = window.ProjectXavierDesignSystem_4d3183 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Small status pill. Used for the "AI parsed" tag on draft cards, "Soon" labels
 * on coming-soon settings, premium/streak markers. Outline style by default;
 * `solid` fills with the tone colour.
 */
function Badge({
  children,
  tone = 'neutral',
  variant = 'outline',
  style,
  ...rest
}) {
  const toneColor = {
    neutral: 'var(--xv-muted)',
    blue: 'var(--xv-blue)',
    violet: 'var(--xv-violet)',
    green: 'var(--xv-green)',
    pink: 'var(--xv-pink)',
    gold: 'var(--xv-gold)'
  }[tone] || 'var(--xv-muted)';
  const outline = {
    color: toneColor,
    background: 'transparent',
    border: `1px solid ${tone === 'neutral' ? 'var(--xv-border)' : 'color-mix(in srgb, ' + toneColor + ' 55%, transparent)'}`
  };
  const solid = {
    color: tone === 'gold' || tone === 'green' ? '#0E1116' : '#fff',
    background: toneColor,
    border: '1px solid transparent'
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontFamily: 'var(--xv-font-sans)',
      fontSize: 'var(--xv-text-micro)',
      fontWeight: 'var(--xv-weight-bold)',
      lineHeight: 1,
      padding: '4px 9px',
      borderRadius: 'var(--xv-radius-pill)',
      textTransform: variant === 'caps' ? 'uppercase' : 'none',
      letterSpacing: variant === 'caps' ? 'var(--xv-tracking-wide)' : 0,
      whiteSpace: 'nowrap',
      ...(variant === 'solid' ? solid : outline),
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Primary action button. Pill-shaped, bold label. The `primary` variant carries
 * the brand-blue fill with a soft neon glow; `ghost` is a quiet inset surface.
 */
function Button({
  title,
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  iconLeft,
  style,
  ...rest
}) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const pads = size === 'sm' ? {
    padding: '8px 16px',
    font: 'var(--xv-text-caption)'
  } : {
    padding: '12px 20px',
    font: 'var(--xv-text-body)'
  };
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: 'none',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    borderRadius: 'var(--xv-radius-pill)',
    fontFamily: 'var(--xv-font-sans)',
    fontWeight: 'var(--xv-weight-bold)',
    fontSize: pads.font,
    padding: pads.padding,
    lineHeight: 1,
    opacity: disabled ? 0.45 : 1,
    transition: 'transform var(--xv-dur-fast) var(--xv-ease), filter var(--xv-dur-fast) var(--xv-ease)',
    whiteSpace: 'nowrap'
  };
  const variants = {
    primary: {
      background: 'var(--xv-primary)',
      color: '#fff',
      boxShadow: disabled ? 'none' : 'var(--xv-glow-primary)'
    },
    ghost: {
      background: 'var(--xv-surface-alt)',
      color: 'var(--xv-text)'
    },
    danger: {
      background: 'var(--xv-negative)',
      color: '#2A0E14',
      boxShadow: disabled ? 'none' : 'var(--xv-glow-pink)'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled || loading,
    style: {
      ...base,
      ...(variants[variant] || variants.primary),
      ...style
    },
    onMouseDown: e => {
      if (!disabled && !loading) e.currentTarget.style.transform = 'scale(0.97)';
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = 'scale(1)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = 'scale(1)';
    }
  }, rest), loading ? /*#__PURE__*/React.createElement(Spinner, {
    light: isPrimary || isDanger
  }) : iconLeft, !loading && (title || children));
}
function Spinner({
  light
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      height: 16,
      borderRadius: '50%',
      border: '2px solid ' + (light ? 'rgba(255,255,255,0.4)' : 'rgba(242,245,249,0.3)'),
      borderTopColor: light ? '#fff' : 'var(--xv-text)',
      display: 'inline-block',
      animation: 'xv-spin 0.7s linear infinite'
    }
  });
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Elevated surface container — the default panel for grouped content. Dark
 * surface, hairline border, 14px radius. Use `tone="info"` for the bluish
 * highlight panel (net-savings / callouts).
 */
function Card({
  children,
  tone = 'default',
  style,
  padding = 16,
  ...rest
}) {
  const tones = {
    default: {
      background: 'var(--xv-surface)',
      borderColor: 'var(--xv-border)'
    },
    info: {
      background: 'var(--xv-surface-info)',
      borderColor: 'var(--xv-border-info)'
    },
    inset: {
      background: 'var(--xv-surface-alt)',
      borderColor: 'var(--xv-border)'
    }
  };
  const t = tones[tone] || tones.default;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: t.background,
      border: `1px solid ${t.borderColor}`,
      borderRadius: 'var(--xv-radius-md)',
      padding,
      fontFamily: 'var(--xv-font-sans)',
      color: 'var(--xv-text)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Feather-icon renderer. ProjectXavier uses Feather (via @expo/vector-icons) as
 * its single icon set: 24×24 grid, 2px stroke, round caps/joins, no fill. This
 * inlines the real Feather geometry for the glyphs the product uses, so icons
 * stay crisp and on-brand with zero runtime dependency. Colour follows
 * `currentColor`; pass `color`/`size`/`strokeWidth` to override.
 */
const PATHS = {
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|polyline:9 22 9 12 15 12 15 22',
  'bar-chart-2': 'line:18 20 18 10|line:12 20 12 4|line:6 20 6 14',
  list: 'line:8 6 21 6|line:8 12 21 12|line:8 18 21 18|line:3 6 3.01 6|line:3 12 3.01 12|line:3 18 3.01 18',
  settings: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z|circle:12 12 3',
  send: 'line:22 2 11 13|polygon:22 2 15 22 11 13 2 9 22 2',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z|circle:12 13 4',
  plus: 'line:12 5 12 19|line:5 12 19 12',
  search: 'circle:11 11 8|line:21 21 16.65 16.65',
  calendar: 'rect:3 4 18 18 2|line:16 2 16 6|line:8 2 8 6|line:3 10 21 10',
  'chevron-down': 'polyline:6 9 12 15 18 9',
  'chevron-right': 'polyline:9 18 15 12 9 6',
  'chevron-up': 'polyline:18 15 12 9 6 15',
  'chevron-left': 'polyline:15 18 9 12 15 6',
  'credit-card': 'rect:1 4 22 16 2|line:1 10 23 10',
  tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z|line:7 7 7.01 7',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2|circle:9 7 4|M23 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75',
  lock: 'rect:3 11 18 11 2|M7 11V7a5 5 0 0 1 10 0v4',
  star: 'polygon:12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2',
  'edit-2': 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  'trash-2': 'polyline:3 6 5 6 21 6|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|line:10 11 10 17|line:14 11 14 17',
  check: 'polyline:20 6 9 17 4 12',
  x: 'line:18 6 6 18|line:6 6 18 18',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|polyline:7 10 12 15 17 10|line:12 15 12 3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|polyline:17 8 12 3 7 8|line:12 3 12 15',
  'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|polyline:16 17 21 12 16 7|line:21 12 9 12',
  'more-horizontal': 'circle:12 12 1|circle:19 12 1|circle:5 12 1',
  activity: 'polyline:22 12 18 12 15 21 9 3 6 12 2 12',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z|circle:12 12 3',
  repeat: 'polyline:17 1 21 5 17 9|M3 11V9a4 4 0 0 1 4-4h14|polyline:7 23 3 19 7 15|M21 13v2a4 4 0 0 1-4 4H3',
  'arrow-up-right': 'line:7 17 17 7|polyline:7 7 17 7 17 17',
  zap: 'polygon:13 2 3 14 12 14 11 22 21 10 12 10 13 2'
};
function renderPart(part, i) {
  if (part.startsWith('line:')) {
    const [x1, y1, x2, y2] = part.slice(5).split(' ');
    return /*#__PURE__*/React.createElement("line", {
      key: i,
      x1: x1,
      y1: y1,
      x2: x2,
      y2: y2
    });
  }
  if (part.startsWith('polyline:')) {
    return /*#__PURE__*/React.createElement("polyline", {
      key: i,
      points: part.slice(9)
    });
  }
  if (part.startsWith('polygon:')) {
    return /*#__PURE__*/React.createElement("polygon", {
      key: i,
      points: part.slice(8)
    });
  }
  if (part.startsWith('circle:')) {
    const [cx, cy, r] = part.slice(7).split(' ');
    return /*#__PURE__*/React.createElement("circle", {
      key: i,
      cx: cx,
      cy: cy,
      r: r
    });
  }
  if (part.startsWith('rect:')) {
    const [x, y, w, h, rx] = part.slice(5).split(' ');
    return /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: x,
      y: y,
      width: w,
      height: h,
      rx: rx,
      ry: rx
    });
  }
  return /*#__PURE__*/React.createElement("path", {
    key: i,
    d: part
  });
}
function Icon({
  name,
  size = 20,
  color = 'currentColor',
  strokeWidth = 2,
  style,
  ...rest
}) {
  const def = PATHS[name];
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      display: 'block',
      flexShrink: 0,
      ...style
    },
    "aria-hidden": "true"
  }, rest), def ? def.split('|').map(renderPart) : null);
}

/** Names available in this icon set — useful for typing / autocomplete. */
const ICON_NAMES = Object.keys(PATHS);
Object.assign(__ds_scope, { Icon, ICON_NAMES });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Round icon button. Tones: `primary` (filled blue with glow — the send/FAB
 * action), `surface` (quiet inset circle — scan, search, more), `ghost`
 * (transparent). Sizes map to the app's 32 / 44 / 56px round controls.
 */
function IconButton({
  name,
  tone = 'surface',
  size = 'md',
  iconColor,
  style,
  ...rest
}) {
  const dim = {
    sm: 32,
    md: 44,
    fab: 56
  }[size] || 44;
  const tones = {
    primary: {
      background: 'var(--xv-blue)',
      color: '#fff',
      boxShadow: 'var(--xv-glow-blue)',
      border: 'none'
    },
    surface: {
      background: 'var(--xv-surface-alt)',
      color: 'var(--xv-text)',
      border: '1px solid var(--xv-border)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--xv-muted)',
      border: 'none'
    }
  };
  const t = tones[tone] || tones.surface;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    style: {
      width: dim,
      height: dim,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
      cursor: 'pointer',
      flexShrink: 0,
      transition: 'transform var(--xv-dur-fast) var(--xv-ease), filter var(--xv-dur-fast) var(--xv-ease)',
      ...t,
      ...style
    },
    onMouseDown: e => {
      e.currentTarget.style.transform = 'scale(0.92)';
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = 'scale(1)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = 'scale(1)';
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: name,
    size: Math.round(dim * 0.45),
    color: iconColor || t.color
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/ListRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Settings / navigation row — a leading icon, a label (with optional sublabel),
 * and a trailing chevron by default. `tone="negative"` tints icon + label pink
 * (destructive actions like Sign out). Pass `trailing` to replace the chevron.
 */
function ListRow({
  icon,
  label,
  sublabel,
  tone = 'default',
  trailing,
  onClick,
  style,
  ...rest
}) {
  const fg = tone === 'negative' ? 'var(--xv-pink)' : 'var(--xv-text)';
  const iconColor = tone === 'negative' ? 'var(--xv-pink)' : 'var(--xv-muted)';
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'var(--xv-surface)',
      border: '1px solid var(--xv-border)',
      borderRadius: 'var(--xv-radius-md)',
      padding: '14px 16px',
      cursor: onClick ? 'pointer' : 'default',
      fontFamily: 'var(--xv-font-sans)',
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 18,
    color: iconColor
  }) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--xv-text-body)',
      color: fg
    }
  }, label), sublabel ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 2,
      fontSize: 'var(--xv-text-caption)',
      color: 'var(--xv-muted)'
    }
  }, sublabel) : null), trailing !== undefined ? trailing : /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 18,
    color: "var(--xv-muted)"
  }));
}
Object.assign(__ds_scope, { ListRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/ListRow.jsx", error: String((e && e.message) || e) }); }

// components/core/SectionLabel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Uppercase micro-label that introduces a section (e.g. "ACCOUNTS", "PLANNED"). */
function SectionLabel({
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      fontFamily: 'var(--xv-font-sans)',
      fontSize: 'var(--xv-text-micro)',
      fontWeight: 'var(--xv-weight-bold)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--xv-tracking-wide)',
      color: 'var(--xv-muted)',
      margin: '0 4px 10px',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { SectionLabel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/SectionLabel.jsx", error: String((e && e.message) || e) }); }

// components/data/AccountRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Account row — an account's emoji icon on a tinted square (with a small series
 * colour dot), the name + meta line, and the closing balance with a period
 * change figure. Used on the Dashboard accounts list and account pickers.
 */
function AccountRow({
  emoji = '🏦',
  iconBg = 'var(--xv-surface-alt)',
  dotColor,
  name,
  meta,
  balance,
  change,
  changeTone = 'neutral',
  onClick,
  style,
  ...rest
}) {
  const changeColor = changeTone === 'positive' ? 'var(--xv-green)' : changeTone === 'negative' ? 'var(--xv-pink)' : 'var(--xv-muted)';
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'var(--xv-surface)',
      border: '1px solid var(--xv-border)',
      borderRadius: 'var(--xv-radius-md)',
      padding: '12px 14px',
      cursor: onClick ? 'pointer' : 'default',
      fontFamily: 'var(--xv-font-sans)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 'var(--xv-radius-chip)',
      background: iconBg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 18
    }
  }, emoji), dotColor ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: -3,
      top: -3,
      width: 10,
      height: 10,
      borderRadius: 5,
      border: '2px solid var(--xv-bg)',
      background: dotColor
    }
  }) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--xv-text-sm)',
      fontWeight: 'var(--xv-weight-semibold)',
      color: 'var(--xv-text)'
    }
  }, name), meta ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 2,
      fontSize: 'var(--xv-text-micro)',
      color: 'var(--xv-muted)'
    }
  }, meta) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "xv-tnum",
    style: {
      fontSize: 'var(--xv-text-sm)',
      fontWeight: 'var(--xv-weight-extrabold)',
      color: 'var(--xv-text)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, balance), change != null ? /*#__PURE__*/React.createElement("div", {
    className: "xv-tnum",
    style: {
      marginTop: 2,
      fontSize: 'var(--xv-text-nano)',
      color: changeColor,
      fontVariantNumeric: 'tabular-nums'
    }
  }, change) : null));
}
Object.assign(__ds_scope, { AccountRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/AccountRow.jsx", error: String((e && e.message) || e) }); }

// components/data/MiniBarChart.jsx
try { (() => {
/**
 * Cash-flow bar chart. Income bars rise above the zero line (green), expense
 * bars drop below it (pink); both share one y-scale so magnitudes compare
 * directly. Non-zero values floor to a visible sliver. Faithful to the app's
 * src/components/ui/BarChart. Pass `data` as [{income, expense}, …].
 */
const MIN_BAR_H = 2;
function MiniBarChart({
  data = [],
  width = 320,
  height = 96,
  style
}) {
  if (!data.length) return null;
  const maxVal = Math.max(...data.flatMap(d => [d.income || 0, d.expense || 0]), 1);
  const pad = 6;
  const halfH = (height - pad * 2) / 2;
  const zeroY = pad + halfH;
  const bucketW = width / data.length;
  const barW = Math.max(2, bucketW * 0.55);
  const barOffset = (bucketW - barW) / 2;
  const barHeight = v => v > 0 ? Math.max(MIN_BAR_H, v / maxVal * halfH) : 0;
  return /*#__PURE__*/React.createElement("svg", {
    width: "100%",
    height: height,
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none",
    style: {
      display: 'block',
      ...style
    }
  }, /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: pad,
    x2: width,
    y2: pad,
    stroke: "#23303f",
    strokeDasharray: "2 4"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: zeroY,
    x2: width,
    y2: zeroY,
    stroke: "var(--xv-border)",
    strokeWidth: "1"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: height - pad,
    x2: width,
    y2: height - pad,
    stroke: "#23303f",
    strokeDasharray: "2 4"
  }), data.map((d, i) => {
    const x = i * bucketW + barOffset;
    const incH = barHeight(d.income || 0);
    const expH = barHeight(d.expense || 0);
    return /*#__PURE__*/React.createElement("g", {
      key: i
    }, d.income > 0 && /*#__PURE__*/React.createElement("rect", {
      x: x,
      y: zeroY - incH,
      width: barW,
      height: incH,
      rx: "1.5",
      fill: "var(--xv-green)",
      opacity: "0.9"
    }), d.expense > 0 && /*#__PURE__*/React.createElement("rect", {
      x: x,
      y: zeroY,
      width: barW,
      height: expH,
      rx: "1.5",
      fill: "var(--xv-pink)",
      opacity: "0.9"
    }));
  }));
}
Object.assign(__ds_scope, { MiniBarChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/MiniBarChart.jsx", error: String((e && e.message) || e) }); }

// components/data/StatTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Labelled figure tile — Income / Expense / Net summary cells. Tiny uppercase
 * label over a bold figure; `tone` colours the figure (positive green, negative
 * pink). `feature` gives the bluish highlight surface (the net-savings card).
 */
function StatTile({
  label,
  value,
  tone,
  feature = false,
  style,
  ...rest
}) {
  const valueColor = tone === 'positive' ? 'var(--xv-green)' : tone === 'negative' ? 'var(--xv-pink)' : 'var(--xv-text)';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      flex: 1,
      background: feature ? 'var(--xv-surface-blue)' : 'var(--xv-surface)',
      border: `1px solid ${feature ? 'var(--xv-border-accent)' : 'var(--xv-border)'}`,
      borderRadius: feature ? 'var(--xv-radius-lg)' : 'var(--xv-radius-md)',
      padding: feature ? '12px 16px' : '12px 14px',
      fontFamily: 'var(--xv-font-sans)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--xv-text-nano)',
      fontWeight: 'var(--xv-weight-bold)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--xv-tracking-wide)',
      color: 'var(--xv-muted)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "xv-tnum",
    style: {
      marginTop: 4,
      fontSize: feature ? 'var(--xv-text-title)' : 'var(--xv-text-body)',
      fontWeight: 'var(--xv-weight-extrabold)',
      color: valueColor,
      letterSpacing: 'var(--xv-tracking-tight)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, value));
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/data/TransactionRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Ledger row — the core list item across Transactions, Dashboard and Account
 * views. An emoji chip on a tinted square (income 💰 / transfer 🔁 / expense 🧾,
 * matching the app), the payee/title with a meta line, and the signed amount
 * (income green, expense pink, transfer muted/neutral). Optional edit/delete.
 */
const CHIP = {
  income: {
    emoji: '💰',
    bg: 'var(--xv-chip-income)'
  },
  transfer: {
    emoji: '🔁',
    bg: 'var(--xv-chip-transfer)'
  },
  expense: {
    emoji: '🧾',
    bg: 'var(--xv-chip-expense)'
  }
};
function TransactionRow({
  type = 'expense',
  title,
  meta,
  amount,
  onEdit,
  onDelete,
  onClick,
  style,
  ...rest
}) {
  const chip = CHIP[type] || CHIP.expense;
  const amountColor = type === 'transfer' ? 'var(--xv-muted)' : type === 'income' ? 'var(--xv-green)' : 'var(--xv-pink)';
  const hasActions = !!(onEdit || onDelete);
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'var(--xv-surface)',
      border: '1px solid var(--xv-border)',
      borderRadius: 'var(--xv-radius-md)',
      padding: 14,
      cursor: onClick ? 'pointer' : 'default',
      fontFamily: 'var(--xv-font-sans)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 'var(--xv-radius-chip)',
      background: chip.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 18,
      flexShrink: 0
    }
  }, chip.emoji), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--xv-text-sm)',
      fontWeight: 'var(--xv-weight-bold)',
      color: 'var(--xv-text)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title), meta ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 2,
      fontSize: 'var(--xv-text-micro)',
      color: 'var(--xv-muted)'
    }
  }, meta) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "xv-tnum",
    style: {
      fontSize: 'var(--xv-text-sm)',
      fontWeight: 'var(--xv-weight-bold)',
      color: amountColor,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap'
    }
  }, amount), hasActions ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, onEdit ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: e => {
      e.stopPropagation();
      onEdit();
    },
    style: miniBtn
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "edit-2",
    size: 15,
    color: "var(--xv-text)"
  })) : null, onDelete ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: e => {
      e.stopPropagation();
      onDelete();
    },
    style: miniBtn
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "trash-2",
    size: 15,
    color: "var(--xv-pink)"
  })) : null) : null));
}
const miniBtn = {
  width: 30,
  height: 30,
  borderRadius: 'var(--xv-radius-sm)',
  background: 'var(--xv-surface-alt)',
  border: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};
Object.assign(__ds_scope, { TransactionRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/TransactionRow.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Bubble.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Chat bubble — `ai` (left, surface) or `me` (right, brand blue). Used by the
 * assistant for its replies and the user's echoed input. Tail corner is tucked
 * (smaller radius) on the speaker's side.
 */
function Bubble({
  from = 'ai',
  children,
  style,
  ...rest
}) {
  const me = from === 'me';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      maxWidth: '82%',
      alignSelf: me ? 'flex-end' : 'flex-start',
      background: me ? 'var(--xv-blue)' : 'var(--xv-surface)',
      border: me ? 'none' : '1px solid var(--xv-border)',
      color: me ? '#fff' : 'var(--xv-text)',
      borderRadius: 'var(--xv-radius-xl)',
      borderBottomRightRadius: me ? 'var(--xv-radius-sm)' : 'var(--xv-radius-xl)',
      borderBottomLeftRadius: me ? 'var(--xv-radius-xl)' : 'var(--xv-radius-sm)',
      padding: '10px 14px',
      fontFamily: 'var(--xv-font-sans)',
      fontSize: 'var(--xv-text-body)',
      lineHeight: 'var(--xv-leading-snug)',
      boxShadow: me ? 'var(--xv-glow-blue-sm)' : 'none',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Bubble });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Bubble.jsx", error: String((e && e.message) || e) }); }

// components/feedback/XavierAvatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Xavier — the assistant's animated gradient-blob mascot and the brand's
 * signature asset. Always subtly alive (breathing + blinking) and reacts to the
 * assistant state. Faithful CSS/SVG recreation of src/components/ui/XavierPet.
 *
 *   idle · listening · thinking · happy · confused · angry
 *
 * State changes are TWEENED, not cut: the eyes morph their geometry, the body
 * gradient + halo crossfade (incl. the angry red), accessories fade in/out, and
 * every transition fires a one-shot squash-and-stretch "reaction" pop.
 *
 * `look` is a colour scheme — pass a preset name ('xavier' | 'mint' | 'sunset'
 * | 'gold' | 'grape' | 'slate') or a custom { from, to } gradient pair.
 */
const LOOKS = {
  xavier: {
    from: '#5B8DEF',
    to: '#7C5BEF'
  },
  mint: {
    from: '#33C27F',
    to: '#2BB6A8'
  },
  sunset: {
    from: '#F2637E',
    to: '#E0884B'
  },
  gold: {
    from: '#E0B84B',
    to: '#E0884B'
  },
  grape: {
    from: '#7C5BEF',
    to: '#B05BEF'
  },
  slate: {
    from: '#5B7A8F',
    to: '#3A4F63'
  }
};
const DARK = '#0E1116';
const EYE_TWEEN = 'all 340ms var(--xv-ease-out)';
const COLOR_TWEEN = '360ms ease';
function XavierAvatar({
  size = 120,
  state = 'idle',
  look = 'xavier',
  style,
  ...rest
}) {
  const scheme = typeof look === 'string' ? LOOKS[look] || LOOKS.xavier : look;
  const angry = state === 'angry';
  const from = angry ? '#F4707E' : scheme.from;
  const to = angry ? '#C4302E' : scheme.to;
  const glow = angry ? '#C4302E' : scheme.from;

  // Body float/breathe per state.
  const bodyAnim = state === 'happy' ? 'xv-hop 0.9s var(--xv-ease-bounce) infinite' : state === 'confused' ? 'xv-shake 0.55s ease-in-out infinite' : state === 'listening' ? 'xv-breathe-fast 1.5s var(--xv-ease-standard) infinite' : 'xv-breathe 1.9s var(--xv-ease-standard) infinite';
  const eyeW = size * 0.13;
  const gap = size * 0.12;
  const blink = state === 'idle' || state === 'listening';
  const uid = React.useId ? React.useId().replace(/:/g, '') : 'xv' + Math.round(scheme.from.length * 7);

  // One-shot squash-and-stretch "reaction" whenever the state changes — runs on
  // a layer above the breathing loop so the two compose instead of fighting.
  const reactRef = React.useRef(null);
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const el = reactRef.current;
    if (!el || !el.animate) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{
      transform: 'scale(1, 1)'
    }, {
      transform: 'scale(1.14, 0.88)',
      offset: 0.28
    }, {
      transform: 'scale(0.94, 1.07)',
      offset: 0.6
    }, {
      transform: 'scale(1.02, 0.99)',
      offset: 0.82
    }, {
      transform: 'scale(1, 1)'
    }], {
      duration: 480,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    });
  }, [state]);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      width: size,
      height: size,
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      width: size * 0.96,
      height: size * 0.96,
      borderRadius: '50%',
      background: glow,
      filter: `blur(${size * 0.16}px)`,
      opacity: 0.45,
      transition: `background-color ${COLOR_TWEEN}`,
      animation: state === 'idle' ? 'xv-glow 2.2s var(--xv-ease-standard) infinite' : 'none'
    }
  }), state === 'listening' && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      width: size,
      height: size,
      borderRadius: '50%',
      border: `2px solid ${scheme.from}`,
      animation: 'xv-ring 1.6s var(--xv-ease-out) infinite'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size,
      animation: bodyAnim
    }
  }, /*#__PURE__*/React.createElement("div", {
    ref: reactRef,
    style: {
      position: 'relative',
      width: size,
      height: size,
      transformOrigin: '50% 60%'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 100 100",
    style: {
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: `grad-${uid}`,
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0",
    style: {
      stopColor: from,
      transition: `stop-color ${COLOR_TWEEN}`
    }
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    style: {
      stopColor: to,
      transition: `stop-color ${COLOR_TWEEN}`
    }
  }))), /*#__PURE__*/React.createElement("ellipse", {
    cx: "50",
    cy: "52",
    rx: "45",
    ry: "44",
    fill: `url(#grad-${uid})`
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: "38",
    cy: "30",
    rx: "20",
    ry: "12",
    fill: "#FFFFFF",
    opacity: "0.16"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: size * 0.04,
      right: size * 0.1,
      display: 'flex',
      gap: size * 0.03,
      opacity: state === 'thinking' ? 1 : 0,
      transition: `opacity ${COLOR_TWEEN}`,
      pointerEvents: 'none'
    }
  }, [0, 1, 2].map(i => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: size * 0.06,
      height: size * 0.06,
      borderRadius: '50%',
      background: scheme.from,
      animation: state === 'thinking' ? `xv-dot 0.5s var(--xv-ease-standard) ${i * 0.12}s infinite` : 'none'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: size * 0.38,
      left: 0,
      right: 0,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      animation: blink ? 'xv-blink 4.2s ease-in-out infinite' : 'none'
    }
  }, /*#__PURE__*/React.createElement(Eye, {
    state: state,
    side: "l",
    w: eyeW,
    size: size
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: gap
    }
  }), /*#__PURE__*/React.createElement(Eye, {
    state: state,
    side: "r",
    w: eyeW,
    size: size
  })), /*#__PURE__*/React.createElement(Cheek, {
    size: size,
    pos: {
      left: size * 0.2
    },
    show: state === 'happy'
  }), /*#__PURE__*/React.createElement(Cheek, {
    size: size,
    pos: {
      right: size * 0.2
    },
    show: state === 'happy'
  }))));
}

/**
 * A single eye, rendered as ONE element across every state so its width, height,
 * corner radii and tilt can CSS-transition (morph) when `state` changes.
 *   idle/listening → tall dark pill
 *   thinking       → narrowed slit
 *   angry          → slit tilted inward (brow)
 *   happy          → flat-bottomed dome (closed, smiling eye)
 *   confused (r)   → smaller, raised
 */
function Eye({
  state,
  side,
  w,
  size
}) {
  let h = size * 0.17;
  let radii = [w, w, w, w]; // tl, tr, br, bl
  let transform = 'none';
  let marginBottom = 0;
  if (state === 'thinking') {
    h = size * 0.075;
  } else if (state === 'angry') {
    h = size * 0.085;
    transform = side === 'l' ? 'rotate(16deg)' : 'rotate(-16deg)';
  } else if (state === 'happy') {
    h = size * 0.105;
    radii = [w, w, 0, 0]; // flat bottom → smiling dome
  } else if (state === 'confused' && side === 'r') {
    h = size * 0.1;
    marginBottom = size * 0.055;
  }
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      width: w,
      height: h,
      background: DARK,
      transform,
      marginBottom,
      borderTopLeftRadius: radii[0],
      borderTopRightRadius: radii[1],
      borderBottomRightRadius: radii[2],
      borderBottomLeftRadius: radii[3],
      transition: EYE_TWEEN
    }
  });
}
function Cheek({
  size,
  pos,
  show
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: size * 0.56,
      width: size * 0.1,
      height: size * 0.055,
      borderRadius: size * 0.05,
      background: 'rgba(255,170,185,0.4)',
      opacity: show ? 1 : 0,
      transform: show ? 'scale(1)' : 'scale(0.4)',
      transition: `opacity ${COLOR_TWEEN}, transform 360ms var(--xv-ease-bounce)`,
      ...pos
    }
  });
}

/** The blob colour presets, for swatch pickers. */
const XAVIER_LOOKS = LOOKS;
Object.assign(__ds_scope, { XavierAvatar, XAVIER_LOOKS });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/XavierAvatar.jsx", error: String((e && e.message) || e) }); }

// components/forms/Pill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Selectable chip — used for account pickers, currency choices, filters. Active
 * fills with brand blue; inactive is a quiet inset surface with muted text.
 */
function Pill({
  label,
  children,
  active = false,
  onClick,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onClick,
    "aria-pressed": active,
    style: {
      border: 'none',
      cursor: 'pointer',
      padding: '8px 16px',
      borderRadius: 'var(--xv-radius-pill)',
      background: active ? 'var(--xv-blue)' : 'var(--xv-surface-alt)',
      color: active ? '#fff' : 'var(--xv-muted)',
      fontFamily: 'var(--xv-font-sans)',
      fontSize: 'var(--xv-text-caption)',
      fontWeight: active ? 'var(--xv-weight-semibold)' : 'var(--xv-weight-medium)',
      whiteSpace: 'nowrap',
      transition: 'background var(--xv-dur-fast) var(--xv-ease)',
      ...style
    }
  }, rest), label ?? children);
}
Object.assign(__ds_scope, { Pill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Pill.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Pill segmented control — e.g. expense / income / transfer, or day / week /
 * month / year. The active segment fills with brand blue on the inset track.
 */
function SegmentedControl({
  options,
  value,
  onChange,
  style,
  ...rest
}) {
  const items = options.map(o => typeof o === 'string' ? {
    value: o,
    label: o
  } : o);
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: 'flex',
      background: 'var(--xv-surface-alt)',
      borderRadius: 'var(--xv-radius-pill)',
      padding: 4,
      gap: 2,
      ...style
    }
  }, rest), items.map(item => {
    const active = item.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: item.value,
      type: "button",
      role: "tab",
      "aria-selected": active,
      onClick: () => onChange && onChange(item.value),
      style: {
        flex: 1,
        border: 'none',
        cursor: 'pointer',
        padding: '8px 12px',
        borderRadius: 'var(--xv-radius-pill)',
        background: active ? 'var(--xv-blue)' : 'transparent',
        color: active ? '#fff' : 'var(--xv-muted)',
        fontFamily: 'var(--xv-font-sans)',
        fontSize: 'var(--xv-text-sm)',
        fontWeight: active ? 'var(--xv-weight-semibold)' : 'var(--xv-weight-medium)',
        textTransform: 'capitalize',
        boxShadow: active ? 'var(--xv-glow-blue-sm)' : 'none',
        transition: 'background var(--xv-dur-fast) var(--xv-ease), color var(--xv-dur-fast) var(--xv-ease)'
      }
    }, item.label);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Text input. Two shapes: `pill` (the assistant composer / search) and `box`
 * (form fields in sheets). Dark surface, near-white text, muted placeholder.
 * Optional leading icon and trailing slot (e.g. a send button).
 */
function TextField({
  value,
  onChange,
  placeholder,
  shape = 'box',
  icon,
  trailing,
  disabled = false,
  multiline = false,
  style,
  inputStyle,
  ...rest
}) {
  const radius = shape === 'pill' ? 'var(--xv-radius-pill)' : 'var(--xv-radius-sm)';
  const Tag = multiline ? 'textarea' : 'input';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: multiline ? 'flex-start' : 'center',
      gap: 8,
      background: 'var(--xv-surface)',
      border: '1px solid var(--xv-border)',
      borderRadius: radius,
      padding: shape === 'pill' ? '10px 16px' : '10px 12px',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 18,
    color: "var(--xv-muted)"
  }) : null, /*#__PURE__*/React.createElement(Tag, _extends({
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    rows: multiline ? 3 : undefined,
    style: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: 'var(--xv-text)',
      fontFamily: 'var(--xv-font-sans)',
      fontSize: 'var(--xv-text-body)',
      resize: multiline ? 'vertical' : undefined,
      ...inputStyle
    }
  }, rest)), trailing);
}
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextField.jsx", error: String((e && e.message) || e) }); }

// ui_kits/projectxavier-app/AssistantScreen.jsx
try { (() => {
/* Assistant home — the Xavier mascot is the hero. Type an expense and send;
   Xavier "thinks", a parsed draft card appears, Save → happy reaction. */
const {
  XavierAvatar,
  IconButton,
  TextField,
  Button,
  Badge,
  Card
} = window.ProjectXavierDesignSystem_4d3183;
const {
  useState
} = React;
function LevelBadge() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 190,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 13px/1 var(--xv-font-sans)',
      color: 'var(--xv-text)'
    }
  }, "Lv 3 \xB7 Saver"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: 6,
      borderRadius: 999,
      background: 'var(--xv-surface-alt)',
      overflow: 'hidden',
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '64%',
      height: '100%',
      background: 'var(--xv-blue)',
      boxShadow: 'var(--xv-glow-blue-sm)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 10px/1 var(--xv-font-mono)',
      color: 'var(--xv-muted)',
      marginTop: 7
    }
  }, "64% to Investor"));
}
function DraftField({
  k,
  v,
  tone
}) {
  const color = tone === 'neg' ? 'var(--xv-pink)' : tone === 'pos' ? 'var(--xv-green)' : 'var(--xv-text)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '6px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 13px/1 var(--xv-font-sans)',
      color: 'var(--xv-muted)'
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    className: "xv-tnum",
    style: {
      font: '600 13px/1 var(--xv-font-sans)',
      color,
      fontVariantNumeric: 'tabular-nums'
    }
  }, v));
}
function AssistantScreen() {
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | thinking | parsed | saved
  const [reply, setReply] = useState(window.XV_DATA.greeting);
  const state = phase === 'thinking' ? 'thinking' : phase === 'saved' ? 'happy' : draft.trim() ? 'listening' : 'idle';
  const send = () => {
    if (!draft.trim()) return;
    setReply('Let me look at that…');
    setPhase('thinking');
    setTimeout(() => {
      setReply('Got it — here\'s what I parsed. Save it?');
      setPhase('parsed');
    }, 1400);
  };
  const save = () => {
    setReply('Saved! Anything else?');
    setPhase('saved');
    setDraft('');
    setTimeout(() => {
      setPhase('idle');
      setReply(window.XV_DATA.greeting);
    }, 2600);
  };
  const discard = () => {
    setPhase('idle');
    setReply('No problem — discarded. What else?');
    setDraft('');
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '8px 20px 16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 340
    }
  }, /*#__PURE__*/React.createElement(XavierAvatar, {
    size: 150,
    state: state,
    look: "xavier"
  }), /*#__PURE__*/React.createElement(LevelBadge, null), /*#__PURE__*/React.createElement("p", {
    style: {
      font: '700 16px/1.4 var(--xv-font-sans)',
      color: 'var(--xv-text)',
      textAlign: 'center',
      margin: '22px 8px 0',
      textWrap: 'pretty'
    }
  }, reply)), phase === 'parsed' && /*#__PURE__*/React.createElement(Card, {
    tone: "default",
    style: {
      borderColor: 'var(--xv-border-accent)',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 14px/1 var(--xv-font-sans)',
      color: 'var(--xv-text)'
    }
  }, "Expense"), /*#__PURE__*/React.createElement(Badge, {
    tone: "blue"
  }, "AI parsed")), /*#__PURE__*/React.createElement(DraftField, {
    k: "Amount",
    v: "\u2212$12.00",
    tone: "neg"
  }), /*#__PURE__*/React.createElement(DraftField, {
    k: "Account",
    v: "Checking"
  }), /*#__PURE__*/React.createElement(DraftField, {
    k: "Payee",
    v: "Joe's"
  }), /*#__PURE__*/React.createElement(DraftField, {
    k: "Category",
    v: "Food"
  }), /*#__PURE__*/React.createElement(DraftField, {
    k: "Date",
    v: "Today"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    title: "Discard",
    variant: "ghost",
    onClick: discard,
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    title: "Save",
    variant: "primary",
    onClick: save,
    style: {
      flex: 1
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    name: "camera",
    tone: "surface"
  }), /*#__PURE__*/React.createElement(TextField, {
    shape: "pill",
    placeholder: "Describe an expense\u2026",
    value: draft,
    onChange: e => setDraft(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') send();
    },
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    name: "send",
    tone: "primary",
    onClick: send
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      font: '400 13px/1 var(--xv-font-sans)',
      color: 'var(--xv-muted)',
      textAlign: 'center',
      marginTop: 12
    }
  }, "Prefer to type it in? Add manually"));
}
Object.assign(window, {
  AssistantScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/projectxavier-app/AssistantScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/projectxavier-app/DashboardScreen.jsx
try { (() => {
/* Dashboard — period overview: net-worth chart card, income/expense tiles,
   net-savings feature card, planned list, accounts list. */
const {
  StatTile,
  AccountRow,
  TransactionRow,
  MiniBarChart,
  Icon,
  SectionLabel
} = window.ProjectXavierDesignSystem_4d3183;
function TopBar({
  period
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      cursor: 'pointer',
      background: 'var(--xv-surface-alt)',
      border: '1px solid var(--xv-border)',
      borderRadius: 999,
      padding: '7px 14px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 14,
    color: "var(--xv-muted)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 13px/1 var(--xv-font-sans)',
      color: 'var(--xv-text)'
    }
  }, period), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 14,
    color: "var(--xv-muted)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, ['search', 'more-horizontal'].map(n => /*#__PURE__*/React.createElement("span", {
    key: n,
    style: {
      width: 32,
      height: 32,
      borderRadius: '50%',
      background: 'var(--xv-surface-alt)',
      border: '1px solid var(--xv-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n,
    size: 14,
    color: "var(--xv-muted)"
  })))));
}
function DashboardScreen() {
  const d = window.XV_DATA;
  const m = window.xvMoney;
  const fmtSeries = n => m(n, {
    signed: n >= 0
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 20px 24px'
    }
  }, /*#__PURE__*/React.createElement(TopBar, {
    period: d.period
  }), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: '800 28px/1.1 var(--xv-font-sans)',
      color: 'var(--xv-text)',
      letterSpacing: '-0.02em',
      margin: '0 0 14px'
    }
  }, "Overview"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--xv-surface)',
      border: '1px solid var(--xv-border)',
      borderRadius: 'var(--xv-radius-lg)',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 16px 4px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 12px/1 var(--xv-font-sans)',
      color: 'var(--xv-muted)'
    }
  }, "Cash flow \xB7 ", d.period), /*#__PURE__*/React.createElement("div", {
    className: "xv-tnum",
    style: {
      font: '800 26px/1.2 var(--xv-font-sans)',
      color: 'var(--xv-text)',
      letterSpacing: '-0.02em',
      marginTop: 2,
      fontVariantNumeric: 'tabular-nums'
    }
  }, m(d.netWorth)), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1.4 var(--xv-font-sans)',
      color: 'var(--xv-muted)',
      marginTop: 2
    }
  }, "Projected in 30d: ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--xv-green)'
    }
  }, "+", m(d.forecast - d.netWorth).replace('$', '$')))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 16px 4px'
    }
  }, /*#__PURE__*/React.createElement(MiniBarChart, {
    data: d.cashFlow,
    height: 92
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      padding: '4px 16px 14px'
    }
  }, /*#__PURE__*/React.createElement(Legend, {
    color: "var(--xv-green)",
    label: "Income"
  }), /*#__PURE__*/React.createElement(Legend, {
    color: "var(--xv-pink)",
    label: "Expenses"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Income",
    value: fmtSeries(d.totals.income),
    tone: "positive"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Expense",
    value: '−' + m(d.totals.expense).replace('−', ''),
    tone: "negative"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Net savings",
    value: fmtSeries(d.totals.net),
    tone: "positive",
    feature: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      margin: '0 4px 10px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, {
    style: {
      margin: 0
    }
  }, "Planned"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      font: '600 12px/1 var(--xv-font-sans)',
      color: 'var(--xv-green-bright)'
    }
  }, "Manage ", /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 12,
    color: "var(--xv-green-bright)"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      marginBottom: 18,
      opacity: 0.75
    }
  }, d.planned.map(p => /*#__PURE__*/React.createElement(TransactionRow, {
    key: p.id,
    type: p.type,
    title: p.title,
    meta: p.meta,
    amount: window.xvMoney(p.amount, {
      signed: p.amount >= 0
    })
  }))), /*#__PURE__*/React.createElement(SectionLabel, null, "Accounts \u2014 as of ", d.period), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, d.accounts.map(a => /*#__PURE__*/React.createElement(AccountRow, {
    key: a.id,
    emoji: a.emoji,
    iconBg: a.tint,
    dotColor: a.series,
    name: a.name,
    meta: a.meta,
    balance: m(a.balance),
    change: window.xvMoney(a.change, {
      signed: a.change >= 0
    }),
    changeTone: a.change >= 0 ? 'positive' : 'negative'
  }))));
}
function Legend({
  color,
  label
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 10px/1 var(--xv-font-sans)',
      color: 'var(--xv-muted)'
    }
  }, label));
}
Object.assign(window, {
  DashboardScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/projectxavier-app/DashboardScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/projectxavier-app/PhoneFrame.jsx
try { (() => {
/* iOS phone frame + status bar + bottom tab bar for the ProjectXavier app.
   Pure presentational shell; the active tab + screen are driven by the app. */
const {
  Icon
} = window.ProjectXavierDesignSystem_4d3183;
const XV_TABS = [{
  id: 'assistant',
  icon: 'home',
  label: 'Assistant'
}, {
  id: 'dashboard',
  icon: 'bar-chart-2',
  label: 'Dashboard'
}, {
  id: 'transactions',
  icon: 'list',
  label: 'Transactions'
}, {
  id: 'settings',
  icon: 'settings',
  label: 'Settings'
}];
function StatusBar() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 22px 0 26px',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 15px/1 var(--xv-font-sans)',
      color: 'var(--xv-text)'
    }
  }, "9:41"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      color: 'var(--xv-text)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "12",
    viewBox: "0 0 18 12",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "0",
    y: "8",
    width: "3",
    height: "4",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "5",
    y: "5",
    width: "3",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "10",
    y: "2.5",
    width: "3",
    height: "9.5",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "15",
    y: "0",
    width: "3",
    height: "12",
    rx: "1"
  })), /*#__PURE__*/React.createElement("svg", {
    width: "17",
    height: "12",
    viewBox: "0 0 17 12",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8.5 2.2c2.6 0 5 1 6.8 2.7l1.2-1.3A11 11 0 0 0 8.5.2 11 11 0 0 0 .5 3.6l1.2 1.3A9 9 0 0 1 8.5 2.2Zm0 3.6c1.6 0 3.1.6 4.2 1.7l1.2-1.3a8 8 0 0 0-10.8 0l1.2 1.3A6 6 0 0 1 8.5 5.8Zm0 3.5 2.1 2.2-2.1-.0-2.1.0 2.1-2.2Z"
  })), /*#__PURE__*/React.createElement("svg", {
    width: "26",
    height: "12",
    viewBox: "0 0 26 12",
    fill: "none"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "0.5",
    y: "0.5",
    width: "22",
    height: "11",
    rx: "3",
    stroke: "currentColor",
    opacity: "0.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "2",
    y: "2",
    width: "17",
    height: "8",
    rx: "1.5",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "24",
    y: "4",
    width: "1.5",
    height: "4",
    rx: "0.75",
    fill: "currentColor",
    opacity: "0.6"
  }))));
}
function TabBar({
  active,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 64,
      flexShrink: 0,
      display: 'flex',
      background: 'var(--xv-surface)',
      borderTop: '1px solid var(--xv-border)',
      paddingBottom: 8
    }
  }, XV_TABS.map(t => {
    const on = t.id === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      type: "button",
      onClick: () => onChange(t.id),
      style: {
        flex: 1,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        paddingTop: 8
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: t.icon,
      size: 22,
      color: on ? 'var(--xv-blue)' : 'var(--xv-muted)'
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        font: '500 10px/1 var(--xv-font-sans)',
        color: on ? 'var(--xv-blue)' : 'var(--xv-muted)'
      }
    }, t.label));
  }));
}
function PhoneFrame({
  active,
  onTab,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 390,
      height: 844,
      background: 'var(--xv-bg)',
      borderRadius: 44,
      border: '10px solid #05070A',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 11,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 120,
      height: 32,
      background: '#05070A',
      borderRadius: 20,
      zIndex: 20
    }
  }), /*#__PURE__*/React.createElement(StatusBar, null), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      position: 'relative'
    }
  }, children), /*#__PURE__*/React.createElement(TabBar, {
    active: active,
    onChange: onTab
  }));
}
Object.assign(window, {
  PhoneFrame,
  XV_TABS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/projectxavier-app/PhoneFrame.jsx", error: String((e && e.message) || e) }); }

// ui_kits/projectxavier-app/SettingsScreen.jsx
try { (() => {
/* Settings — accounts/preferences/data/security sections, an interactive avatar
   look picker (changes Xavier's colours), and the premium upsell. */
const {
  ListRow,
  SectionLabel,
  Card,
  XavierAvatar,
  Badge,
  Icon
} = window.ProjectXavierDesignSystem_4d3183;
const {
  useState: useSetState
} = React;
const LOOKS = [{
  id: 'xavier',
  label: 'Xavier'
}, {
  id: 'mint',
  label: 'Mint'
}, {
  id: 'sunset',
  label: 'Sunset'
}, {
  id: 'gold',
  label: 'Gold'
}, {
  id: 'grape',
  label: 'Grape'
}, {
  id: 'slate',
  label: 'Slate'
}];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'SGD', 'JPY', 'AUD'];
function SettingsScreen() {
  const [look, setLook] = useSetState('xavier');
  const [currency, setCurrency] = useSetState('USD');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 20px 24px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: '800 28px/1.1 var(--xv-font-sans)',
      color: 'var(--xv-text)',
      letterSpacing: '-0.02em',
      margin: '0 0 16px'
    }
  }, "Settings"), /*#__PURE__*/React.createElement(SectionLabel, null, "Accounts"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(ListRow, {
    icon: "credit-card",
    label: "Manage accounts",
    onClick: () => {}
  }), /*#__PURE__*/React.createElement(ListRow, {
    icon: "tag",
    label: "Manage categories",
    onClick: () => {}
  }), /*#__PURE__*/React.createElement(ListRow, {
    icon: "users",
    label: "Manage payees",
    onClick: () => {}
  })), /*#__PURE__*/React.createElement(SectionLabel, null, "Preferences"), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(XavierAvatar, {
    size: 40,
    state: "idle",
    look: look
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 16px/1.2 var(--xv-font-sans)',
      color: 'var(--xv-text)'
    }
  }, "Assistant avatar"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 12px/1 var(--xv-font-sans)',
      color: 'var(--xv-muted)',
      marginTop: 3
    }
  }, "Blob \xB7 ", LOOKS.find(l => l.id === look).label))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 14
    }
  }, LOOKS.map(l => /*#__PURE__*/React.createElement("button", {
    key: l.id,
    type: "button",
    onClick: () => setLook(l.id),
    style: {
      width: 52,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      background: 'transparent',
      border: 'none',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      borderRadius: '50%',
      padding: 3,
      border: l.id === look ? '2px solid var(--xv-blue)' : '2px solid transparent'
    }
  }, /*#__PURE__*/React.createElement(XavierAvatar, {
    size: 34,
    state: "idle",
    look: l.id
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: l.id === look ? '700 11px/1 var(--xv-font-sans)' : '400 11px/1 var(--xv-font-sans)',
      color: l.id === look ? 'var(--xv-text)' : 'var(--xv-muted)'
    }
  }, l.label))))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 16px/1.2 var(--xv-font-sans)',
      color: 'var(--xv-text)'
    }
  }, "Currency"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 12px/1 var(--xv-font-sans)',
      color: 'var(--xv-muted)',
      marginTop: 3
    }
  }, currency)), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 18,
    color: "var(--xv-muted)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8
    }
  }, CURRENCIES.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    type: "button",
    onClick: () => setCurrency(c),
    style: {
      border: 'none',
      cursor: 'pointer',
      padding: '7px 14px',
      borderRadius: 999,
      background: c === currency ? 'var(--xv-blue)' : 'var(--xv-surface-alt)',
      color: c === currency ? '#fff' : 'var(--xv-muted)',
      font: '600 13px/1 var(--xv-font-sans)'
    }
  }, c)))), /*#__PURE__*/React.createElement(SectionLabel, null, "Data"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(ListRow, {
    icon: "download",
    label: "Export encrypted backup",
    onClick: () => {}
  }), /*#__PURE__*/React.createElement(ListRow, {
    icon: "upload",
    label: "Restore from backup",
    onClick: () => {}
  })), /*#__PURE__*/React.createElement(SectionLabel, null, "Security"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(ListRow, {
    icon: "lock",
    label: "Require Face ID on launch",
    trailing: /*#__PURE__*/React.createElement(Toggle, {
      on: true
    })
  }), /*#__PURE__*/React.createElement(ListRow, {
    icon: "log-out",
    label: "Sign out",
    tone: "negative",
    onClick: () => {}
  })), /*#__PURE__*/React.createElement(SectionLabel, null, "ProjectXavier Premium"), /*#__PURE__*/React.createElement(ListRow, {
    icon: "star",
    label: "Upgrade \u2014 unlimited AI, receipt scan, sync",
    trailing: /*#__PURE__*/React.createElement(Badge, {
      tone: "gold",
      variant: "solid"
    }, "Pro"),
    onClick: () => {}
  }));
}
function Toggle({
  on
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: 42,
      height: 26,
      borderRadius: 999,
      background: on ? 'var(--xv-green)' : 'var(--xv-surface-alt)',
      position: 'relative',
      display: 'inline-block',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 3,
      left: on ? 19 : 3,
      width: 20,
      height: 20,
      borderRadius: '50%',
      background: '#fff',
      transition: 'left var(--xv-dur-fast) var(--xv-ease)'
    }
  }));
}
Object.assign(window, {
  SettingsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/projectxavier-app/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/projectxavier-app/TransactionsScreen.jsx
try { (() => {
/* Transactions — searchable, day-grouped ledger with a floating add button. */
const {
  TransactionRow,
  Icon,
  SectionLabel,
  IconButton
} = window.ProjectXavierDesignSystem_4d3183;
const {
  useState: useTxState
} = React;
function TransactionsScreen() {
  const d = window.XV_DATA;
  const m = window.xvMoney;
  const [q, setQ] = useTxState('');
  const [searching, setSearching] = useTxState(false);
  const days = d.days.map(day => ({
    ...day,
    items: day.items.filter(it => !q.trim() || (it.title + ' ' + it.meta).toLowerCase().includes(q.toLowerCase()))
  })).filter(day => day.items.length);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      minHeight: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 20px 90px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      cursor: 'pointer',
      background: 'var(--xv-surface-alt)',
      border: '1px solid var(--xv-border)',
      borderRadius: 999,
      padding: '7px 14px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 14,
    color: "var(--xv-muted)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 13px/1 var(--xv-font-sans)',
      color: 'var(--xv-text)'
    }
  }, d.period), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 14,
    color: "var(--xv-muted)"
  })), /*#__PURE__*/React.createElement(IconButton, {
    name: searching ? 'x' : 'search',
    tone: "surface",
    size: "sm",
    onClick: () => {
      setSearching(s => !s);
      setQ('');
    }
  })), searching ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      background: 'var(--xv-surface)',
      border: '1px solid var(--xv-blue)',
      borderRadius: 'var(--xv-radius-md)',
      padding: '8px 12px',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 16,
    color: "var(--xv-muted)"
  }), /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "Search payee, category, note\u2026",
    style: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: 'var(--xv-text)',
      font: '400 15px/1 var(--xv-font-sans)'
    }
  })) : /*#__PURE__*/React.createElement("h1", {
    style: {
      font: '800 28px/1.1 var(--xv-font-sans)',
      color: 'var(--xv-text)',
      letterSpacing: '-0.02em',
      margin: 0
    }
  }, "Transactions"), days.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      font: '400 14px/1.4 var(--xv-font-sans)',
      color: 'var(--xv-muted)',
      textAlign: 'center',
      marginTop: 28
    }
  }, "No matching transactions."), days.map(day => /*#__PURE__*/React.createElement("div", {
    key: day.title,
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, day.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, day.items.map(it => /*#__PURE__*/React.createElement(TransactionRow, {
    key: it.id,
    type: it.type,
    title: it.title,
    meta: it.meta,
    amount: m(it.amount, {
      signed: it.amount >= 0
    }),
    onClick: () => {}
  })))))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      right: 20,
      bottom: 20
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    name: "plus",
    tone: "primary",
    size: "fab"
  })));
}
Object.assign(window, {
  TransactionsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/projectxavier-app/TransactionsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/projectxavier-app/data.js
try { (() => {
/* Fake-but-plausible data for the ProjectXavier app UI kit. Plain globals so the
   babel screen scripts can read them without modules. Money in major units. */
window.XV_DATA = {
  greeting: "Hi, I'm Xavier. Tell me about an expense, or snap a receipt.",
  netWorth: 12840.5,
  forecast: 13110.0,
  period: 'June 2026',
  totals: {
    income: 4120.0,
    expense: 1495.1,
    net: 2624.9
  },
  cashFlow: [{
    income: 3200,
    expense: 60
  }, {
    income: 0,
    expense: 240
  }, {
    income: 0,
    expense: 95
  }, {
    income: 120,
    expense: 410
  }, {
    income: 0,
    expense: 55
  }, {
    income: 800,
    expense: 180
  }, {
    income: 0,
    expense: 320
  }, {
    income: 0,
    expense: 130
  }],
  accounts: [{
    id: 'checking',
    emoji: '🏦',
    tint: 'var(--xv-chip-transfer)',
    series: 'var(--xv-series-1)',
    name: 'Checking',
    meta: 'Bank · start $1,200',
    balance: 2015.0,
    change: 815.0
  }, {
    id: 'savings',
    emoji: '💰',
    tint: 'var(--xv-chip-income)',
    series: 'var(--xv-series-2)',
    name: 'Savings',
    meta: 'Bank · start $9,400',
    balance: 9890.0,
    change: 490.0
  }, {
    id: 'card',
    emoji: '💳',
    tint: 'var(--xv-chip-expense)',
    series: 'var(--xv-series-4)',
    name: 'Amex Gold',
    meta: 'Credit · start −$640',
    balance: -1065.0,
    change: -425.0
  }, {
    id: 'cash',
    emoji: '👛',
    tint: 'var(--xv-surface-alt)',
    series: 'var(--xv-series-3)',
    name: 'Cash',
    meta: 'Wallet · start $80',
    balance: 60.0,
    change: -20.0
  }],
  planned: [{
    id: 'p1',
    type: 'expense',
    title: 'Rent',
    meta: 'Jul 1',
    amount: -1800
  }, {
    id: 'p2',
    type: 'income',
    title: 'Payroll',
    meta: 'Jul 15',
    amount: 3200
  }, {
    id: 'p3',
    type: 'expense',
    title: 'Spotify',
    meta: 'Jul 6',
    amount: -11.99
  }],
  days: [{
    title: 'Today',
    items: [{
      id: 't1',
      type: 'expense',
      title: "Joe's Coffee",
      meta: 'Checking · Food',
      amount: -4.5
    }, {
      id: 't2',
      type: 'expense',
      title: 'Lyft',
      meta: 'Amex Gold · Transport',
      amount: -18.4
    }]
  }, {
    title: 'Yesterday',
    items: [{
      id: 'y1',
      type: 'income',
      title: 'Payroll',
      meta: 'Checking · Salary',
      amount: 3200.0
    }, {
      id: 'y2',
      type: 'expense',
      title: 'Whole Foods',
      meta: 'Amex Gold · Groceries',
      amount: -86.2
    }, {
      id: 'y3',
      type: 'transfer',
      title: 'Transfer',
      meta: 'Checking → Savings',
      amount: -500.0
    }]
  }, {
    title: 'Jun 24',
    items: [{
      id: 'j1',
      type: 'expense',
      title: 'Shell',
      meta: 'Amex Gold · Fuel',
      amount: -52.1
    }, {
      id: 'j2',
      type: 'expense',
      title: 'Netflix',
      meta: 'Checking · Subscriptions',
      amount: -15.49
    }]
  }]
};

/* Format major-unit number as USD, signed optional. */
window.xvMoney = function (n, {
  signed = false
} = {}) {
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const sign = n < 0 ? '−' : signed ? '+' : '';
  return `${sign}$${abs}`;
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/projectxavier-app/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.ICON_NAMES = __ds_scope.ICON_NAMES;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.ListRow = __ds_scope.ListRow;

__ds_ns.SectionLabel = __ds_scope.SectionLabel;

__ds_ns.AccountRow = __ds_scope.AccountRow;

__ds_ns.MiniBarChart = __ds_scope.MiniBarChart;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.TransactionRow = __ds_scope.TransactionRow;

__ds_ns.Bubble = __ds_scope.Bubble;

__ds_ns.XavierAvatar = __ds_scope.XavierAvatar;

__ds_ns.XAVIER_LOOKS = __ds_scope.XAVIER_LOOKS;

__ds_ns.Pill = __ds_scope.Pill;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.TextField = __ds_scope.TextField;

})();
