/* =============================================================================
 * 主控：仿真调度 / 动画时间轴 / HUD / 环境与模型面板 / UI 交互
 * ========================================================================== */
(function () {
  'use strict';

  var DEFAULT_ENV = {
    tempC: 15, latitude: 40, azimuth: 0,
    windCross: 0, windHead: 0,
    useCoriolis: true, useWind: true
  };

  var PRESETS = (window.Ballistics && Ballistics.PRESETS) || {};
  var cfg = {
    preset: 'mortar120',
    v0: 318,
    angle: 45,
    hBoom: 12,
    twist: 0,
    fragCount: 800,
    seed: 2024,
    env: Object.assign({}, DEFAULT_ENV)
  };

  var sim = null;
  var simTime = 0;
  var playing = true;
  var speed = 2;
  var lastTs = 0;
  var totalTime = 1;
  var boomShown = false;
  var simTimer = 0;
  var currentPanel = null;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    canvas: $('scene'),
    charts: $('charts'),
    hudT: $('hud-t'), hudH: $('hud-h'), hudV: $('hud-v'), hudMach: $('hud-mach'),
    hudAlpha: $('hud-alpha'), hudQ: $('hud-q'), hudX: $('hud-x'), hudZ: $('hud-z'),
    hudSpin: $('hud-spin'), hudSg: $('hud-sg'),
    statusDot: $('status-dot'), statusMode: $('status-mode'), statusCode: $('status-code'),
    toast: $('toast'),
    btnPlay: $('btn-play'), btnReset: $('btn-reset'),
    speedSeg: $('speed-seg'),
    camControls: $('cam-controls'),
    rngV0: $('rng-v0'), rngAngle: $('rng-angle'), rngBoom: $('rng-boom'), rngWind: $('rng-wind'),
    valV0: $('val-v0'), valAngle: $('val-angle'), valBoom: $('val-boom'), valWind: $('val-wind'),
    statRange: $('stat-range'), statAlt: $('stat-alt'), statMach: $('stat-mach'),
    statDrift: $('stat-drift'), statVimp: $('stat-vimp'), statR90: $('stat-r90'),
    fragModel: $('frag-model'),
    windChip: $('wind-chip'),
    overlay: $('overlay'), panelEnv: $('panel-env'), panelModel: $('panel-model'),
    btnEnv: $('btn-env'), btnModel: $('btn-model'),
    envWindCross: $('env-wind-cross'), envWindHead: $('env-wind-head'),
    envTemp: $('env-temp'), envLat: $('env-lat'), envTwist: $('env-twist'), envFrag: $('env-frag'),
    envSeed: $('env-seed'),
    presetSeg: $('preset-seg'), presetNote: $('preset-note'), rowTwist: $('row-twist'),
    hudStabLabel: $('hud-stab-label'), hudSgUnit: $('hud-sg-unit'),
    envWindCrossVal: $('env-wind-cross-val'), envWindHeadVal: $('env-wind-head-val'),
    envTempVal: $('env-temp-val'), envLatVal: $('env-lat-val'),
    envTwistVal: $('env-twist-val'), envFragVal: $('env-frag-val'), envSeedVal: $('env-seed-val'),
    envCoriolis: $('env-coriolis'), envWindOn: $('env-wind-on'),
    envReset: $('env-reset'), envSummary: $('env-summary')
  };

  var lastHud = {};

  /* ------------------------------ 仿真调度 ------------------------------ */
  function runSim(autoplay) {
    var t0 = performance.now();
    sim = Ballistics.simulate(cfg);
    var calcMs = performance.now() - t0;

    simTime = 0;
    boomShown = false;
    // 运行到最后一枚破片落地为止
    totalTime = sim.flightTime + (sim.fragments.duration || 0) + 0.15;
    playing = autoplay !== false;

    if (window.Scene3D && Scene3D.setData) Scene3D.setData(sim);
    syncCamButtons(window.Scene3D && Scene3D.getCameraMode ? Scene3D.getCameraMode() : 'follow');
    if (window.Charts) {
      el.charts.innerHTML = '';
      Charts.init(el.charts, sim);
    }

    if (sim.spinStabilized) {
      el.hudStabLabel.textContent = '稳定因子';
      el.hudSgUnit.textContent = 'Sg';
    } else {
      el.hudStabLabel.textContent = '静稳定裕度';
      el.hudSgUnit.textContent = 'cal';
    }

    updateStats();
    updatePlayBtn();
    updateStatus();
    updateHUD(true);
    updateWindChip();
    updateEnvSummary();

    el.statusCode.textContent = 'SOLVED ' + calcMs.toFixed(0) + 'ms';
    clearTimeout(runSim._t);
    runSim._t = setTimeout(function () {
      if (el.statusCode.textContent.indexOf('SOLVED') === 0) el.statusCode.textContent = 'SYS.READY';
    }, 2600);
  }

  function scheduleSim() {
    clearTimeout(simTimer);
    simTimer = setTimeout(function () { runSim(true); }, 110);
  }

  /* ------------------------------ 时间插值 ------------------------------ */
  function sampleAt(t) {
    var s = sim.samples;
    var dt = sim.sampleDt;
    var f = t / dt;
    var i = Math.floor(f);
    if (i < 0) i = 0;
    if (i >= s.length - 1) return s[s.length - 1];
    var a = s[i], b = s[i + 1], u = f - i;
    return {
      t: t,
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
      vx: a.vx + (b.vx - a.vx) * u,
      vy: a.vy + (b.vy - a.vy) * u,
      vz: a.vz + (b.vz - a.vz) * u,
      speed: a.speed + (b.speed - a.speed) * u,
      mach: a.mach + (b.mach - a.mach) * u,
      alpha: a.alpha + (b.alpha - a.alpha) * u,
      beta: a.beta + (b.beta - a.beta) * u,
      theta: a.theta + (b.theta - a.theta) * u,
      qdyn: a.qdyn + (b.qdyn - a.qdyn) * u,
      wx: a.wx + (b.wx - a.wx) * u,
      sg: a.sg + (b.sg - a.sg) * u
    };
  }

  /* ------------------------------ HUD 更新 ------------------------------ */
  function setText(node, key, value) {
    if (lastHud[key] === value) return;
    lastHud[key] = value;
    node.textContent = value;
  }

  function updateHUD(force) {
    if (!sim) return;
    if (force) lastHud = {};

    var after = simTime >= sim.boom.t;
    var st = after
      ? sampleAt(Math.max(0, sim.boom.t - 0.004))
      : sampleAt(Math.min(simTime, sim.flightTime));

    setText(el.hudT, 't', simTime.toFixed(2));
    setText(el.hudH, 'h', after ? sim.boom.y.toFixed(1) : Math.max(0, st.y).toFixed(st.y < 100 ? 1 : 0));
    setText(el.hudV, 'v', (after ? sim.boom.speed : st.speed).toFixed(0));
    setText(el.hudMach, 'mach', st.mach.toFixed(2));
    setText(el.hudAlpha, 'alpha', (st.alpha >= 0 ? '+' : '') + st.alpha.toFixed(2));
    setText(el.hudQ, 'q', st.qdyn.toFixed(1));
    setText(el.hudX, 'x', Math.sqrt(st.x * st.x + st.z * st.z).toFixed(0));
    setText(el.hudZ, 'z', (after ? sim.boom.z : st.z).toFixed(1));
    setText(el.hudSpin, 'spin', (after ? sim.boom.spin : st.wx).toFixed(0));
    if (sim.spinStabilized) {
      setText(el.hudSg, 'sg', (isFinite(st.sg) ? st.sg.toFixed(2) : '—'));
    } else {
      setText(el.hudSg, 'sg', sim.staticMargin.toFixed(2));
    }
  }

  function updateStats() {
    if (!sim) return;
    el.statRange.textContent = sim.range.toFixed(0) + ' m';
    el.statAlt.textContent = sim.maxAlt.toFixed(0) + ' m';
    el.statMach.textContent = sim.maxMach.toFixed(2);
    el.statDrift.textContent = (sim.drift >= 0 ? '+' : '') + sim.drift.toFixed(1) + ' m';
    el.statVimp.textContent = sim.impactSpeed.toFixed(0) + ' m/s';
    el.statR90.textContent = sim.fragments.r90.toFixed(0) + ' m';
    var fr = sim.fragments;
    el.fragModel.textContent =
      'MOTT μ ' + (fr.mu * 1000).toFixed(1) + ' g · 均值 ' + (fr.meanMass * 1000).toFixed(1) +
      ' g · GURNEY ' + fr.vGurney.toFixed(0) + ' m/s · 自转 ' + (fr.spin || 0).toFixed(0) +
      ' rad/s · 破片 ' + fr.count;
  }

  /* ------------------------------ 状态显示 ------------------------------ */
  function updateStatus() {
    if (!sim) return;
    var dot = el.statusDot;
    dot.className = 'dot';

    if (simTime + 1e-6 >= totalTime) {
      dot.classList.add('done');
      el.statusMode.textContent = '仿真完成';
    } else if (simTime >= sim.boom.t) {
      dot.classList.add('boom');
      el.statusMode.textContent = '破片飞散中';
    } else if (simTime > 0.05) {
      dot.classList.add('armed');
      el.statusMode.textContent = '弹道飞行中';
    } else {
      el.statusMode.textContent = '待发射';
    }
  }

  function showToast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.toast.classList.remove('show'); }, 4200);
  }

  /* --------------------------- 风场/环境显示 ---------------------------- */
  function windText() {
    var c = cfg.env.windCross, h = cfg.env.windHead;
    var parts = [];
    if (Math.abs(c) >= 0.5) parts.push((c > 0 ? '右风 ' : '左风 ') + Math.abs(c).toFixed(0) + ' m/s');
    if (Math.abs(h) >= 0.5) parts.push((h > 0 ? '逆风 ' : '顺风 ') + Math.abs(h).toFixed(0) + ' m/s');
    return parts.length ? parts.join(' · ') : '无风';
  }

  function updateWindChip() {
    if (!el.windChip) return;
    var txt = '风 ' + windText();
    if (cfg.env.useCoriolis) txt += ' · 科氏 ' + Math.abs(cfg.env.latitude).toFixed(0) + (cfg.env.latitude >= 0 ? '°N' : '°S');
    el.windChip.textContent = txt;
  }

  function updateEnvSummary() {
    if (!el.envSummary) return;
    el.envSummary.textContent =
      (sim && sim.presetName ? sim.presetName + ' · ' : '') +
      'ISA 大气 ' + cfg.env.tempC.toFixed(0) + '°C · 纬度 ' + cfg.env.latitude.toFixed(0) + '° · ' +
      '风 ' + windText() + ' · ' + (cfg.twist > 0 ? ('缠距 1:' + cfg.twist) : '不旋转') +
      ' · 破片 ' + cfg.fragCount + ' 片 · 种子 #' + cfg.seed +
      (cfg.env.useCoriolis ? ' · 科氏力开' : ' · 科氏力关');
  }

  /* ------------------------------ 播放控制 ------------------------------ */
  function updatePlayBtn() {
    el.btnPlay.textContent = playing ? '暂停' : '继续';
  }

  function togglePlay() {
    if (simTime + 1e-6 >= totalTime) {
      simTime = 0;
      boomShown = false;
      playing = true;
    } else {
      playing = !playing;
    }
    updatePlayBtn();
    updateStatus();
  }

  /* ------------------------------ 动画循环 ------------------------------ */
  function loop(ts) {
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.12) : 0;
    lastTs = ts;

    if (!sim) {
      if (window.Scene3D) Scene3D.render();
      requestAnimationFrame(loop);
      return;
    }

    if (playing) {
      simTime += dt * speed;
      if (simTime >= totalTime) {
        simTime = totalTime;
        playing = false;
        updatePlayBtn();
      }
    }

    if (!boomShown && simTime >= sim.boom.t) {
      boomShown = true;
      var fr = sim.fragments;
      var b = sim.boom;
      showToast('动爆 · 炸高 ' + b.y.toFixed(0) + ' m · 落速 ' + b.speed.toFixed(0) +
        ' m/s · 攻角 ' + (b.alpha >= 0 ? '+' : '') + b.alpha.toFixed(1) + '° · 侧偏 ' +
        (b.z >= 0 ? '+' : '') + b.z.toFixed(0) + ' m · 破片 ' + fr.count +
        ' 枚 · R90 ' + fr.r90.toFixed(0) + ' m');
    }

    if (window.Scene3D) {
      Scene3D.setTime(simTime);
      Scene3D.render();
    }
    if (window.Charts) Charts.setTime(simTime);

    updateHUD();
    updateStatus();
    requestAnimationFrame(loop);
  }

  /* ------------------------------ 面板交互 ------------------------------ */
  function openPanel(id) {
    currentPanel = id;
    el.overlay.hidden = false;
    el.panelEnv.hidden = id !== 'panel-env';
    el.panelModel.hidden = id !== 'panel-model';
    document.body.classList.add('modal-open');
  }

  function closePanels() {
    currentPanel = null;
    el.overlay.hidden = true;
    document.body.classList.remove('modal-open');
  }

  /* ------------------------------ 弹型切换 ------------------------------ */
  function applyPresetUI(presetId, autoplay) {
    var p = PRESETS[presetId];
    if (!p) return;
    if (window.Ballistics && Ballistics.applyPreset) Ballistics.applyPreset(presetId);
    cfg.preset = presetId;
    var d = p.defaults;
    cfg.v0 = d.v0;
    cfg.angle = d.angle;
    cfg.twist = d.twist;
    cfg.fragCount = d.fragCount;
    cfg.hBoom = 12;

    // 滑杆范围随弹型变化
    el.rngV0.min = d.v0Min;
    el.rngV0.max = d.v0Max;
    el.rngV0.value = cfg.v0;
    el.valV0.textContent = cfg.v0;
    el.rngAngle.max = d.angleMax;
    el.rngAngle.value = cfg.angle;
    el.valAngle.textContent = cfg.angle;
    el.rngBoom.value = cfg.hBoom;
    el.valBoom.textContent = cfg.hBoom;

    // 缠距对尾翼弹不可用
    var noSpin = d.twist === 0;
    el.envTwist.disabled = noSpin;
    el.rowTwist.classList.toggle('disabled', noSpin);
    el.envTwistVal.textContent = noSpin ? '不旋转' : ('1:' + cfg.twist);
    el.presetNote.textContent = noSpin
      ? '当前弹型：120mm 迫弹（尾翼稳定、不旋转；McCoy 附录 C 实测气动系数，v0=318 m/s 为装药 4）'
      : '当前弹型：120mm 旋转稳定杀爆弹代表弹（线膛炮，1:18 缠距；气动系数按 105mm M1 同类换算，动/静稳定性由 Sg 判定）';

    Array.prototype.forEach.call(el.presetSeg.children, function (b) {
      b.classList.toggle('active', b.dataset.preset === presetId);
    });

    syncEnvUI();
    updateWindChip();
    updateEnvSummary();
    if (autoplay !== false) runSim(true);
  }

  el.presetSeg.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || btn.dataset.preset === cfg.preset) return;
    applyPresetUI(btn.dataset.preset, true);
  });

  /* ------------------------------ UI 绑定 ------------------------------ */
  el.btnPlay.addEventListener('click', togglePlay);

  el.btnReset.addEventListener('click', function () {
    simTime = 0;
    boomShown = false;
    playing = true;
    updatePlayBtn();
    updateStatus();
    updateHUD(true);
    el.toast.classList.remove('show');
  });

  el.speedSeg.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    speed = Number(btn.dataset.speed);
    Array.prototype.forEach.call(el.speedSeg.children, function (b) {
      b.classList.toggle('active', b === btn);
    });
  });

  el.camControls.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    syncCamButtons(btn.dataset.mode);
    if (window.Scene3D) Scene3D.setCameraMode(btn.dataset.mode);
  });

  /* 相机按钮高亮与实际模式保持一致（重算后 setData 会切回跟随） */
  function syncCamButtons(mode) {
    Array.prototype.forEach.call(el.camControls.children, function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  }

  function bindSlider(input, label, key, fmt, rebuild) {
    input.addEventListener('input', function () {
      var v = Number(input.value);
      label.textContent = fmt ? fmt(v) : v;
      cfg[key] = v;
      if (rebuild) scheduleSim();
    });
  }

  bindSlider(el.rngV0, el.valV0, 'v0', null, true);
  bindSlider(el.rngAngle, el.valAngle, 'angle', null, true);
  bindSlider(el.rngBoom, el.valBoom, 'hBoom', null, true);
  // 横风滑杆直接映射到 env.windCross
  el.rngWind.addEventListener('input', function () {
    cfg.env.windCross = Number(el.rngWind.value);
    el.valWind.textContent = cfg.env.windCross;
    syncEnvUI();
    updateWindChip();
    updateEnvSummary();
    scheduleSim();
  });

  /* 环境面板控件 */
  function bindEnvRange(input, label, key, fmt, after, topLevel) {
    input.addEventListener('input', function () {
      var v = Number(input.value);
      if (topLevel) cfg[key] = v;
      else cfg.env[key] = v;
      if (label) label.textContent = fmt ? fmt(v) : v;
      if (after) after();
      updateWindChip();
      updateEnvSummary();
      scheduleSim();
    });
  }

  bindEnvRange(el.envWindCross, el.envWindCrossVal, 'windCross', function (v) {
    return v + ' m/s';
  }, function () { el.rngWind.value = cfg.env.windCross; el.valWind.textContent = cfg.env.windCross; });
  bindEnvRange(el.envWindHead, el.envWindHeadVal, 'windHead', function (v) {
    return (v > 0 ? '逆 ' : v < 0 ? '顺 ' : '') + Math.abs(v) + ' m/s';
  });
  bindEnvRange(el.envTemp, el.envTempVal, 'tempC', function (v) { return v + ' °C'; });
  bindEnvRange(el.envLat, el.envLatVal, 'latitude', function (v) {
    return Math.abs(v) + (v >= 0 ? '°N' : '°S');
  });
  bindEnvRange(el.envTwist, el.envTwistVal, 'twist', function (v) { return '1:' + v; }, null, true);
  bindEnvRange(el.envFrag, el.envFragVal, 'fragCount', function (v) { return String(v); }, null, true);
  bindEnvRange(el.envSeed, el.envSeedVal, 'seed', function (v) { return '#' + v; }, null, true);

  el.envCoriolis.addEventListener('change', function () {
    cfg.env.useCoriolis = el.envCoriolis.checked;
    updateWindChip();
    updateEnvSummary();
    scheduleSim();
  });
  el.envWindOn.addEventListener('change', function () {
    cfg.env.useWind = el.envWindOn.checked;
    scheduleSim();
  });
  el.envReset.addEventListener('click', function () {
    Object.assign(cfg.env, DEFAULT_ENV);
    var pd = (PRESETS[cfg.preset] || {}).defaults || {};
    cfg.twist = pd.twist != null ? pd.twist : 18;
    cfg.fragCount = pd.fragCount != null ? pd.fragCount : 800;
    cfg.seed = 2024;
    syncEnvUI();
    updateWindChip();
    updateEnvSummary();
    runSim(true);
  });

  function syncEnvUI() {
    el.envWindCross.value = cfg.env.windCross;
    el.envWindHead.value = cfg.env.windHead;
    el.envTemp.value = cfg.env.tempC;
    el.envLat.value = cfg.env.latitude;
    el.envTwist.value = cfg.twist > 0 ? cfg.twist : 18;
    el.envFrag.value = cfg.fragCount;
    el.envSeed.value = cfg.seed;
    el.envCoriolis.checked = cfg.env.useCoriolis;
    el.envWindOn.checked = cfg.env.useWind;
    el.envWindCrossVal.textContent = cfg.env.windCross + ' m/s';
    el.envWindHeadVal.textContent = (cfg.env.windHead > 0 ? '逆 ' : cfg.env.windHead < 0 ? '顺 ' : '') +
      Math.abs(cfg.env.windHead) + ' m/s';
    el.envTempVal.textContent = cfg.env.tempC + ' °C';
    el.envLatVal.textContent = Math.abs(cfg.env.latitude) + (cfg.env.latitude >= 0 ? '°N' : '°S');
    el.envTwistVal.textContent = cfg.twist > 0 ? ('1:' + cfg.twist) : '不旋转';
    el.envFragVal.textContent = String(cfg.fragCount);
    el.envSeedVal.textContent = '#' + cfg.seed;
    el.valWind.textContent = cfg.env.windCross;
    el.rngWind.value = cfg.env.windCross;
  }

  /* 面板开关 */
  el.btnEnv.addEventListener('click', function () { openPanel('panel-env'); });
  el.btnModel.addEventListener('click', function () { openPanel('panel-model'); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.addEventListener('click', closePanels);
  });
  el.overlay.addEventListener('click', function (e) {
    if (e.target === el.overlay) closePanels();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.overlay.hidden) { closePanels(); return; }
    if (e.code === 'Space' && e.target === document.body && el.overlay.hidden) {
      e.preventDefault();
      togglePlay();
    }
  });

  window.addEventListener('resize', function () {
    if (window.Scene3D) Scene3D.resize();
    if (window.Charts) Charts.resize();
  });

  /* ------------------------------ 启动 ------------------------------ */
  if (window.Scene3D) Scene3D.init(el.canvas);
  applyPresetUI('mortar120', false);
  runSim(true);
  updatePlayBtn();
  requestAnimationFrame(loop);

})();
