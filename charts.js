/* =============================================================================
 * Charts — 六路弹道参数时间历程曲线（Canvas 2D）
 * 高度 / 速度-马赫 / 攻角 / 弹道倾角 / 角速度 / 动压
 * ========================================================================== */
(function (global) {
  'use strict';

  var DEFS = [
    {
      title: '高度 H',
      color: '#4fe6ff',
      pick: function (s) { return s.y; },
      fmt: function (v) { return v.toFixed(0) + ' m'; }
    },
    {
      title: '速度 V / 马赫 Ma',
      color: '#4fe6ff',
      color2: '#b38cff',
      pick: function (s) { return s.speed; },
      pick2: function (s) { return s.mach; },
      fmt: function (v, s) { return v.toFixed(0) + ' m/s · Ma ' + (s ? s.mach.toFixed(2) : '—'); }
    },
    {
      title: '攻角 α / 偏航 β',
      color: '#ffb43a',
      colors: ['#ffb43a', '#5ee6a8'],
      picks: [
        function (s) { return s.alpha; },
        function (s) { return s.beta; }
      ],
      fmt: function (v, s) {
        return 'α ' + (v >= 0 ? '+' : '') + v.toFixed(2) + '° · β ' +
          (s ? ((s.beta >= 0 ? '+' : '') + s.beta.toFixed(2) + '°') : '—');
      },
      signed: true,
      hiRate: true
    },
    {
      title: '弹道倾角 θ',
      color: '#5ee6a8',
      pick: function (s) { return s.theta; },
      fmt: function (v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '°'; },
      signed: true
    },
    {
      title: '侧偏 Z（风偏 + 偏流 + 科氏）',
      color: '#ff9d5c',
      pick: function (s) { return s.z; },
      fmt: function (v) { return v.toFixed(1) + ' m'; }
    },
    {
      title: '动压 q',
      color: '#ff7a5c',
      pick: function (s) { return s.qdyn; },
      fmt: function (v) { return v.toFixed(1) + ' kPa'; }
    },
    {
      title: '自转 ωx',
      color: '#8bd3ff',
      pick: function (s) { return s.wx; },
      fmt: function (v) { return v.toFixed(0) + ' rad/s · ' + (v * 60 / (2 * Math.PI)).toFixed(0) + ' rpm'; }
    }
  ];

  var container = null;
  var sim = null;
  var cells = [];
  var curT = 0;
  var ro = null;

  var MONO = '"JetBrains Mono", Consolas, "Microsoft YaHei", monospace';

  /* ------------------------------------------------------------------ */
  function build() {
    if (!sim) return;
    var s = sim.samples;
    var n = s.length;

    cells.forEach(function (c) {
      var def = c.def;
      var maxPts = def.hiRate ? n : 780;
      var step = Math.max(1, Math.ceil(n / maxPts));
      c.ts.length = 0;
      c.lines = def.picks ? def.picks.map(function () { return []; }) : [[]];
      c.sec = def.pick2 ? [] : null;

      for (var i = 0; i < n; i += step) {
        var sm = s[i];
        c.ts.push(sm.t);
        if (def.picks) {
          for (var k = 0; k < def.picks.length; k++) c.lines[k].push(def.picks[k](sm));
        } else {
          c.lines[0].push(def.pick(sm));
        }
        if (c.sec) c.sec.push(def.pick2(sm));
      }

      // 主范围
      var mn = Infinity, mx = -Infinity;
      for (var a = 0; a < c.lines.length; a++) {
        var arr = c.lines[a];
        for (var j = 0; j < arr.length; j++) {
          if (arr[j] < mn) mn = arr[j];
          if (arr[j] > mx) mx = arr[j];
        }
      }
      if (!isFinite(mn) || !isFinite(mx)) { mn = 0; mx = 1; }
      if (def.signed) {
        var m = Math.max(Math.abs(mn), Math.abs(mx), 1e-3) * 1.18;
        mn = -m; mx = m;
      } else {
        var pad = (mx - mn) * 0.10 || 1;
        mn -= pad; mx += pad;
        if (mn > 0 && mn < (mx - mn) * 0.06) mn = 0;
      }
      if (mx - mn < 1e-9) { mx = mn + 1; }
      c.min = mn; c.max = mx;

      // 副轴范围
      if (c.sec) {
        var m2n = Infinity, m2x = -Infinity;
        for (var b = 0; b < c.sec.length; b++) {
          if (c.sec[b] < m2n) m2n = c.sec[b];
          if (c.sec[b] > m2x) m2x = c.sec[b];
        }
        if (!isFinite(m2n)) { m2n = 0; m2x = 1; }
        var p2 = (m2x - m2n) * 0.12 || 0.1;
        c.min2 = Math.max(0, m2n - p2);
        c.max2 = m2x + p2;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  function fmtTick(v) {
    var a = Math.abs(v);
    if (a >= 10000) return (v / 1000).toFixed(0) + 'k';
    if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  function yOf(c, v, padT, ph) {
    var t = (v - c.min) / (c.max - c.min);
    return padT + ph * (1 - t);
  }

  function yOf2(c, v, padT, ph) {
    var t = (v - c.min2) / (c.max2 - c.min2);
    return padT + ph * (1 - t);
  }

  function strokeSeries(ctx, c, arr, color, alpha, limitT, padL, padT, pw, ph, secondary, glow) {
    var ft = sim.flightTime || 1;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < arr.length; i++) {
      var t = c.ts[i];
      if (t > limitT) break;
      var x = padL + (t / ft) * pw;
      var y = secondary ? yOf2(c, arr[i], padT, ph) : yOf(c, arr[i], padT, ph);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    if (!started) return;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.2;
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function drawCell(c) {
    var ctx = c.ctx, w = c.w, h = c.h;
    if (!ctx || w < 4 || h < 4) return;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#070c12';
    ctx.fillRect(0, 0, w, h);

    var padL = 5, padR = 6, padT = 16, padB = 11;
    var pw = Math.max(4, w - padL - padR);
    var ph = Math.max(4, h - padT - padB);
    var ft = sim.flightTime || 1;

    // 水平网格
    ctx.strokeStyle = 'rgba(120,180,200,0.09)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = Math.round(padT + ph * g / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(w - padR, gy);
      ctx.stroke();
    }

    // 零线
    if (c.min < 0 && c.max > 0) {
      var zy = Math.round(yOf(c, 0, padT, ph)) + 0.5;
      ctx.strokeStyle = 'rgba(140,200,220,0.18)';
      ctx.beginPath();
      ctx.moveTo(padL, zy);
      ctx.lineTo(w - padR, zy);
      ctx.stroke();
    }

    // 起爆时刻
    if (sim.boom && sim.boom.t > 0) {
      var bx = padL + (sim.boom.t / ft) * pw;
      ctx.strokeStyle = 'rgba(255,180,58,0.25)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(bx, padT);
      ctx.lineTo(bx, padT + ph);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 副轴（马赫数，先画，置于底层）
    if (c.sec) {
      strokeSeries(ctx, c, c.sec, c.def.color2, 0.30, 1e9, padL, padT, pw, ph, true, false);
      strokeSeries(ctx, c, c.sec, c.def.color2, 0.72, curT, padL, padT, pw, ph, true, false);
    }

    // 主曲线：全量暗、已飞过亮
    for (var li = 0; li < c.lines.length; li++) {
      var col = c.def.colors ? c.def.colors[li] : c.def.color;
      strokeSeries(ctx, c, c.lines[li], col, 0.26, 1e9, padL, padT, pw, ph, false, false);
    }
    for (var lj = 0; lj < c.lines.length; lj++) {
      var col2 = c.def.colors ? c.def.colors[lj] : c.def.color;
      strokeSeries(ctx, c, c.lines[lj], col2, 0.95, curT, padL, padT, pw, ph, false, true);
    }

    // 游标
    var cx = padL + Math.min(1, Math.max(0, curT / ft)) * pw;
    ctx.strokeStyle = 'rgba(230,250,255,0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, padT);
    ctx.lineTo(Math.round(cx) + 0.5, padT + ph);
    ctx.stroke();

    // 当前值点
    var sample = sampleAt(curT);
    if (sample) {
      if (c.lines.length === 1) {
        var v0 = c.lines[0];
        // 用原始样本值而非降采样，保证精确
        var dv = c.def.pick(sample);
        if (isFinite(dv)) {
          var dy = yOf(c, dv, padT, ph);
          ctx.fillStyle = c.def.color;
          ctx.shadowColor = c.def.color;
          ctx.shadowBlur = 7;
          ctx.beginPath();
          ctx.arc(cx, dy, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      } else {
        for (var lk = 0; lk < c.lines.length; lk++) {
          var dvv = c.def.picks[lk](sample);
          if (!isFinite(dvv)) continue;
          ctx.fillStyle = c.def.colors[lk];
          ctx.beginPath();
          ctx.arc(cx, yOf(c, dvv, padT, ph), 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 刻度值
    ctx.font = '8px ' + MONO;
    ctx.fillStyle = '#6b8794';
    ctx.textAlign = 'right';
    ctx.fillText(fmtTick(c.max), w - padR - 1, padT + 8);
    ctx.fillText(fmtTick(c.min), w - padR - 1, padT + ph - 1);
    ctx.textAlign = 'left';

    if (c.isLast) {
      ctx.fillStyle = '#546c78';
      ctx.font = '8px ' + MONO;
      ctx.fillText('0', padL, h - 2);
      ctx.textAlign = 'right';
      ctx.fillText('t / s', w - padR, h - 2);
      ctx.textAlign = 'left';
    }
  }

  function sampleAt(t) {
    if (!sim) return null;
    var s = sim.samples;
    var n = s.length;
    var f = t / sim.sampleDt;
    var i = Math.floor(f);
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    return s[i];
  }

  function updateReadouts() {
    var sm = sampleAt(curT);
    if (!sm) return;
    cells.forEach(function (c) {
      var v;
      if (c.def.picks) v = c.def.picks[0](sm);
      else v = c.def.pick(sm);
      var txt = c.def.fmt(v, sm);
      if (c.curEl.textContent !== txt) c.curEl.textContent = txt;
    });
  }

  function drawAll() {
    if (!sim) return;
    for (var i = 0; i < cells.length; i++) drawCell(cells[i]);
    updateReadouts();
  }

  /* ------------------------------------------------------------------ */
  function init(el, s) {
    container = el;
    sim = s;
    cells = [];
    curT = 0;
    container.innerHTML = '';

    var defs = DEFS.slice();
    if (s && !s.spinStabilized) {
      defs[6] = {
        title: '总攻角 αt',
        color: '#8bd3ff',
        pick: function (sm) { return sm.alphaT; },
        fmt: function (v) { return v.toFixed(2) + '°'; }
      };
    }

    defs.forEach(function (def, idx) {
      var cellEl = document.createElement('div');
      cellEl.className = 'chart-cell';

      var cv = document.createElement('canvas');
      cellEl.appendChild(cv);

      var tag = document.createElement('div');
      tag.className = 'chart-tag';
      tag.textContent = def.title;
      cellEl.appendChild(tag);

      var cur = document.createElement('div');
      cur.className = 'chart-cur';
      cur.textContent = '—';
      cellEl.appendChild(cur);

      container.appendChild(cellEl);

      cells.push({
        def: def,
        el: cellEl,
        cv: cv,
        ctx: cv.getContext('2d'),
        curEl: cur,
        w: 0, h: 0, dpr: 1,
        ts: [], lines: [], sec: null,
        min: 0, max: 1, min2: 0, max2: 1,
        isLast: idx === defs.length - 1
      });
    });

    build();
    resize();

    if (window.ResizeObserver) {
      try {
        if (ro) ro.disconnect();
        ro = new ResizeObserver(function () { resize(); });
        ro.observe(container);
      } catch (e) { /* noop */ }
    }

    requestAnimationFrame(function () { resize(); drawAll(); });
  }

  function resize() {
    if (!cells.length) return;
    cells.forEach(function (c) {
      var rect = c.el.getBoundingClientRect();
      var w = Math.max(1, Math.round(rect.width));
      var h = Math.max(1, Math.round(rect.height));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.w === w && c.h === h && c.dpr === dpr) return;
      c.w = w; c.h = h; c.dpr = dpr;
      c.cv.width = Math.round(w * dpr);
      c.cv.height = Math.round(h * dpr);
      c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    drawAll();
  }

  function setTime(t) {
    if (!sim) return;
    curT = Math.max(0, t);
    drawAll();
  }

  global.Charts = {
    init: init,
    setTime: setTime,
    resize: resize
  };

})(window);
