/* =============================================================================
 * Scene3D — Canvas 2D 手写透视投影渲染器
 * 120mm 杀爆弹外弹道 + 动爆破片三维可视化
 * 无外部依赖，ES5/ES2015 兼容
 * ========================================================================== */
(function (global) {
  'use strict';

  var FOV = 40 * Math.PI / 180;
  var NEAR = 2.0;
  var DEG = Math.PI / 180;

  var canvas = null, ctx = null;
  var W = 1, H = 1, W2 = 0.5, H2 = 0.5, dpr = 1, focal = 1;

  var sim = null;
  var time = 0;
  var camMode = 'follow';
  var userControl = false;

  var cam = { yaw: -0.62, pitch: 0.26, dist: 1200, tx: 0, ty: 200, tz: 0 };
  var camS = { yaw: -0.62, pitch: 0.26, dist: 1200, tx: 0, ty: 200, tz: 0 };
  var panX = 0, panY = 0, panZ = 0;
  var landCells = [];

  var camX = 0, camY = 0, camZ = 0;
  var fwX = 0, fwY = -1, fwZ = 0;
  var rtX = 1, rtY = 0, rtZ = 0;
  var upX = 0, upY = 0, upZ = 0;

  var pOut = { x: 0, y: 0, z: 0, ok: false };
  var skyGrad = null, skyGradH = -1;
  var lastFrame = 0;

  /* 预分配 */
  var smoke = [];
  var fragGroups = [[], [], [], [], [], [], [], [], [], [], [], []];
  var tmp = { x: 0, y: 0, z: 0 };
  /* 破片头配色：弹头区（前向锥）偏白热，弹底区（后向锥）偏橙红；列 = 飞行时段 */
  var ZONE_COLORS = [
    ['#fffdf4', '#fff4cf', '#ffe6a6', '#ffcf74'],
    ['#fff6d8', '#ffe08a', '#ffb43a', '#ff8a3d'],
    ['#ffe1bd', '#ffb37a', '#ff7a45', '#e8502a']
  ];

  /* ---------------------- 弹体三维模型（旋转体网格） ---------------------- */
  /* [距弹尖轴向距离 m, 半径 m, 材质 0=引信 1=弹体 2=弹带] */
  var SHELL_PROFILE = [
    [0.000, 0.0048, 0], [0.010, 0.0100, 0], [0.022, 0.0142, 0],
    [0.038, 0.0210, 1], [0.062, 0.0290, 1], [0.092, 0.0372, 1],
    [0.128, 0.0452, 1], [0.166, 0.0522, 1], [0.205, 0.0572, 1],
    [0.245, 0.0597, 1], [0.300, 0.0600, 1], [0.370, 0.0600, 1],
    [0.440, 0.0600, 1], [0.505, 0.0600, 1], [0.532, 0.0602, 1],
    [0.540, 0.0626, 2], [0.566, 0.0626, 2], [0.574, 0.0602, 1],
    [0.615, 0.0588, 1], [0.648, 0.0522, 1], [0.676, 0.0470, 1],
    [0.700, 0.0448, 1]
  ];
  var PROF_N = SHELL_PROFILE.length;
  var RING_SEG = 16;
  var SHELL_CG = 0.348;       // 质心距弹尖 (m) = xcgD(2.90) × D(0.12)
  var SHELL_LEN = 0.700;      // 弹长 (m)
  var MAT_RGB = [[64, 68, 72], [92, 102, 82], [176, 140, 72]];
  var LIGHT_DIR = (function () {
    var lx = -0.42, ly = 0.80, lz = 0.43;
    var ln = Math.sqrt(lx * lx + ly * ly + lz * lz);
    return [lx / ln, ly / ln, lz / ln];
  })();
  var meshBuf = [];
  for (var mbi = 0; mbi < PROF_N * RING_SEG; mbi++) {
    meshBuf.push({ wx: 0, wy: 0, wz: 0, sx: 0, sy: 0, sz: 0, ok: false });
  }

  /* ------------------------------------------------------------------ */
  /* 工具                                                               */
  /* ------------------------------------------------------------------ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothK(dt, rate) { return 1 - Math.exp(-dt * rate); }

  /* ------------------------------------------------------------------ */
  /* 投影                                                               */
  /* ------------------------------------------------------------------ */
  function project(x, y, z) {
    var dx = x - camX, dy = y - camY, dz = z - camZ;
    var vz = dx * fwX + dy * fwY + dz * fwZ;
    if (vz < NEAR) { pOut.ok = false; return pOut; }
    var vx = dx * rtX + dy * rtY + dz * rtZ;
    var vy = dx * upX + dy * upY + dz * upZ;
    var s = focal / vz;
    pOut.x = W2 + vx * s;
    pOut.y = H2 - vy * s;
    pOut.z = vz;
    pOut.ok = true;
    return pOut;
  }

  function projectWorld(x, y, z, out) {
    var dx = x - camX, dy = y - camY, dz = z - camZ;
    var vz = dx * fwX + dy * fwY + dz * fwZ;
    if (vz < NEAR) return false;
    var vx = dx * rtX + dy * rtY + dz * rtZ;
    var vy = dx * upX + dy * upY + dz * upZ;
    var s = focal / vz;
    out[0] = W2 + vx * s;
    out[1] = H2 - vy * s;
    out[2] = vz;
    return true;
  }

  /* 世界空间线段绘制，近平面裁剪 */
  function line3(x1, y1, z1, x2, y2, z2) {
    var ax = x1 - camX, ay = y1 - camY, az = z1 - camZ;
    var bx = x2 - camX, by = y2 - camY, bz = z2 - camZ;
    var az2 = ax * fwX + ay * fwY + az * fwZ;
    var bz2 = bx * fwX + by * fwY + bz * fwZ;

    if (az2 < NEAR && bz2 < NEAR) return false;

    var ax2, ay2, bx2, by2;
    if (az2 < NEAR) {
      var t = (NEAR - az2) / (bz2 - az2);
      ax += (bx - ax) * t; ay += (by - ay) * t; az += (bz - az) * t;
      az2 = NEAR;
    } else if (bz2 < NEAR) {
      var t2 = (NEAR - bz2) / (az2 - bz2);
      bx += (ax - bx) * t2; by += (ay - by) * t2; bz += (az - bz) * t2;
      bz2 = NEAR;
    }

    ax2 = ax * rtX + ay * rtY + az * rtZ;
    ay2 = ax * upX + ay * upY + az * upZ;
    bx2 = bx * rtX + by * rtY + bz * rtZ;
    by2 = bx * upX + by * upY + bz * upZ;

    var s1 = focal / az2, s2 = focal / bz2;
    ctx.moveTo(W2 + ax2 * s1, H2 - ay2 * s1);
    ctx.lineTo(W2 + bx2 * s2, H2 - by2 * s2);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 相机                                                               */
  /* ------------------------------------------------------------------ */
  function shellState(t) {
    if (!sim) return null;
    var s = sim.samples, n = s.length;
    var f = t / sim.sampleDt;
    var i = clamp(Math.floor(f), 0, n - 2);
    var u = clamp(f - i, 0, 1);
    var a = s[i], b = s[i + 1];
    var wxI = a.wx + (b.wx - a.wx) * u;
    // 采样间隔 10 ms 对高速自转（周期可低至 ~5 ms）欠采样，采样四元数的滚转相位
    // 混叠；按插值角速度绕弹轴重建连续滚转（弹轴方向仍取采样值，不受影响）
    var hp = wxI * Math.max(0, t - a.t) * 0.5;
    var c = Math.cos(hp), sn = Math.sin(hp);
    var qw = a.quat[0], qx = a.quat[1], qy = a.quat[2], qz = a.quat[3];
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
      speed: a.speed + (b.speed - a.speed) * u,
      wx: wxI,
      quat: [qw * c - qx * sn, qw * sn + qx * c, qy * c + qz * sn, qz * c - qy * sn]
    };
  }

  function desiredCamera() {
    var t = time;
    var ft = sim.flightTime;
    var b = sim.boom;

    if (camMode === 'follow') {
      if (t < ft) {
        var sh = shellState(t);
        return {
          yaw: -0.62, pitch: 0.30,
          dist: 1900 + sh.speed * 4.2,
          tx: sh.x, ty: sh.y * 0.92 + 50, tz: sh.z
        };
      }
      var tau = t - b.t;
      var k = clamp(tau / 2.5, 0, 1);
      return {
        yaw: -0.62, pitch: lerp(0.30, 0.40, k),
        dist: lerp(1850, 2700, k),
        tx: b.x, ty: b.y + 30 + 150 * k, tz: b.z
      };
    }

    // global / orbit
    return {
      yaw: -0.55, pitch: 0.33,
      dist: sim.range * 1.30,
      tx: sim.range * 0.50, ty: sim.maxAlt * 0.28, tz: 0
    };
  }

  function updateCamera(dt) {
    if (!sim) return;

    var d = desiredCamera();
    var k = smoothK(dt, 3.2);

    camS.tx += (d.tx + panX - camS.tx) * k;
    camS.ty += (d.ty + panY - camS.ty) * k;
    camS.tz += (d.tz + panZ - camS.tz) * k;

    if (!userControl) {
      camS.yaw += (d.yaw - camS.yaw) * smoothK(dt, 2.2);
      camS.pitch += (d.pitch - camS.pitch) * smoothK(dt, 2.2);
      camS.dist += (d.dist - camS.dist) * smoothK(dt, 2.6);
    } else {
      camS.yaw += (cam.yaw - camS.yaw) * smoothK(dt, 6);
      camS.pitch += (cam.pitch - camS.pitch) * smoothK(dt, 6);
      camS.dist += (cam.dist - camS.dist) * smoothK(dt, 6);
    }

    camS.pitch = clamp(camS.pitch, -0.02, 1.45);

    var cp = Math.cos(camS.pitch), sp = Math.sin(camS.pitch);
    camX = camS.tx + camS.dist * cp * Math.sin(camS.yaw);
    camY = camS.ty + camS.dist * sp;
    camZ = camS.tz + camS.dist * cp * Math.cos(camS.yaw);

    var dx = camS.tx - camX, dy = camS.ty - camY, dz = camS.tz - camZ;
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    fwX = dx / L; fwY = dy / L; fwZ = dz / L;

    // right = normalize(cross(forward, worldUp))
    var rx = -fwZ, ry = 0, rz = fwX;
    var rl = Math.sqrt(rx * rx + rz * rz) || 1e-6;
    rtX = rx / rl; rtY = ry; rtZ = rz / rl;

    // up = cross(right, forward)
    upX = rtY * fwZ - rtZ * fwY;
    upY = rtZ * fwX - rtX * fwZ;
    upZ = rtX * fwY - rtY * fwX;
    var ul = Math.sqrt(upX * upX + upY * upY + upZ * upZ) || 1;
    upX /= ul; upY /= ul; upZ /= ul;
  }

  /* ------------------------------------------------------------------ */
  /* 场景绘制                                                           */
  /* ------------------------------------------------------------------ */
  function drawSky(horizonY) {
    var hh = Math.max(1, Math.min(H, horizonY + 40));
    if (!skyGrad || skyGradH !== hh) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, hh);
      skyGrad.addColorStop(0, '#04070d');
      skyGrad.addColorStop(0.55, '#06111a');
      skyGrad.addColorStop(0.85, '#0a1c27');
      skyGrad.addColorStop(1, '#12303c');
      skyGradH = hh;
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, hh + 1);
  }

  function drawGround(horizonY) {
    var hy = clamp(horizonY, -H * 0.5, H * 1.5);
    if (hy >= H) return;
    var g = ctx.createLinearGradient(0, hy, 0, H);
    g.addColorStop(0, '#123039');
    g.addColorStop(0.10, '#0c2029');
    g.addColorStop(0.45, '#08141c');
    g.addColorStop(1, '#0a1a24');
    ctx.fillStyle = g;
    ctx.fillRect(0, hy, W, H - hy);

    // 地平线辉光
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var gh = ctx.createLinearGradient(0, hy - 34, 0, hy + 22);
    gh.addColorStop(0, 'rgba(90,220,240,0)');
    gh.addColorStop(0.70, 'rgba(70,200,225,0.20)');
    gh.addColorStop(1, 'rgba(70,200,225,0)');
    ctx.fillStyle = gh;
    ctx.fillRect(0, hy - 34, W, 56);
    ctx.restore();
  }

  function gridAlpha(x, z) {
    var dx = x - camX, dz = z - camZ;
    var d = Math.sqrt(dx * dx + dz * dz + camY * camY * 0.25);
    return clamp(1 - d / 30000, 0, 1);
  }

  function drawGrid() {
    if (!sim) return;
    var xMin = -3000, xMax = sim.range + 4000;
    var zMin = -8000, zMax = 8000;
    var step = 1000;
    var majorStep = 5000;

    ctx.save();
    ctx.lineWidth = 1;

    // 沿 x 方向线（z 变化）
    for (var z = zMin; z <= zMax; z += step) {
      var major = (Math.abs(z) % majorStep === 0);
      var a = gridAlpha(sim.range * 0.5, z) * (major ? 0.26 : 0.095);
      if (a < 0.005) continue;
      ctx.strokeStyle = 'rgba(90,220,240,' + a.toFixed(3) + ')';
      ctx.beginPath();
      line3(xMin, 0, z, xMax, 0, z);
      ctx.stroke();
    }

    // 沿 z 方向线（x 变化）
    for (var x = xMin; x <= xMax; x += step) {
      var m2 = (x % majorStep === 0);
      var a2 = gridAlpha(x, 0) * (m2 ? 0.26 : 0.095);
      if (a2 < 0.005) continue;
      ctx.strokeStyle = 'rgba(90,220,240,' + a2.toFixed(3) + ')';
      ctx.beginPath();
      line3(x, 0, zMin, x, 0, zMax);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGroundCircle(cx, cz, radius, color, alpha, width, dash) {
    if (radius < 1) return;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    var started = false;
    var seg = 72;
    for (var i = 0; i <= seg; i++) {
      var a = i / seg * Math.PI * 2;
      var p = project(cx + Math.cos(a) * radius, 0.6, cz + Math.sin(a) * radius);
      if (p.ok) {
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      } else {
        started = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawRangeRings() {
    if (!sim || time < sim.boom.t) return;
    var b = sim.boom, f = sim.fragments;
    var tau = time - b.t;
    var k = clamp(tau / 0.35, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGroundCircle(b.x, b.z, f.r50, '#46d3e6', 0.42 * k, 1.4, [6, 8]);
    drawGroundCircle(b.x, b.z, f.r90, '#ffb43a', 0.40 * k, 1.4, [6, 8]);
    drawGroundCircle(b.x, b.z, f.maxRadius, '#ff4d4d', 0.30 * k, 1.2, [3, 10]);
    ctx.restore();
  }

  /* --------------------------- 地面风矢量指示 --------------------------- */
  function drawWindIndicator() {
    if (!sim || !sim.env) return;
    var env = sim.env;
    var wc = env.windCross || 0, wh = env.windHead || 0;
    if (env.useWind === false || (Math.abs(wc) < 0.5 && Math.abs(wh) < 0.5)) return;
    // 风矢量：横风 + 吹向 +z（右），纵风 + 为逆风（吹向 -x）
    var wx = -wh, wz = wc;
    var mag = Math.sqrt(wx * wx + wz * wz) || 1;
    var scale = 90 + Math.min(90, mag * 7);
    var ox = -180, oz = -210;
    var ex = ox + wx / mag * scale, ez = oz + wz / mag * scale;
    var a = project(ox, 1, oz);
    var b = project(ex, 1, ez);
    if (!a.ok || !b.ok) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(110, 205, 255, 0.72)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    var vx = b.x - a.x, vy = b.y - a.y;
    var vl = Math.sqrt(vx * vx + vy * vy) || 1;
    var nx = -vy / vl, ny = vx / vl;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - vx / vl * 9 + nx * 4, b.y - vy / vl * 9 + ny * 4);
    ctx.lineTo(b.x - vx / vl * 9 - nx * 4, b.y - vy / vl * 9 - ny * 4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(130, 220, 255, 0.85)';
    ctx.fill();
    ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = 'rgba(150, 220, 240, 0.8)';
    ctx.fillText('W ' + mag.toFixed(0) + ' m/s', a.x + 8, a.y - 6);
    ctx.restore();
  }

  function drawTrajectory() {
    if (!sim) return;
    var s = sim.samples, n = s.length;
    var step = n > 1600 ? 2 : 1;
    var i, p, started;

    // 全弹道（暗）
    ctx.save();
    ctx.strokeStyle = 'rgba(44,125,148,0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    started = false;
    for (i = 0; i < n; i += step) {
      p = project(s[i].x, s[i].y, s[i].z);
      if (p.ok) {
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      } else started = false;
    }
    ctx.stroke();

    // 已飞过（亮）
    var idx = clamp(Math.floor(time / sim.sampleDt), 0, n - 1);
    ctx.strokeStyle = '#4fe6ff';
    ctx.lineWidth = 1.9;
    ctx.shadowColor = 'rgba(79,230,255,0.85)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    started = false;
    for (i = 0; i <= idx; i += step) {
      p = project(s[i].x, s[i].y, s[i].z);
      if (p.ok) {
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      } else started = false;
    }
    // 连到当前插值位置
    if (time < sim.flightTime) {
      var sh = shellState(time);
      if (sh) {
        p = project(sh.x, sh.y, sh.z);
        if (p.ok) {
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTicksOnTrajectory() {
    // 每 5 秒一个刻度点，强化速度感
    if (!sim) return;
    var s = sim.samples;
    var interval = 5;
    var nextT = 0;
    ctx.save();
    ctx.fillStyle = 'rgba(160,240,255,0.55)';
    for (var i = 0; i < s.length; i++) {
      if (s[i].t >= nextT && s[i].t <= Math.min(time, sim.flightTime)) {
        var p = project(s[i].x, s[i].y, s[i].z);
        if (p.ok) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        nextT += interval;
      }
    }
    ctx.restore();
  }

  function drawLaunchMarker() {
    if (!sim) return;
    var p = project(0, 0, 0);
    if (!p.ok) return;
    var x = p.x, y = p.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(70,211,230,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.globalAlpha = 0.4;
    ctx.stroke();

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#7fb9c8';
    ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('LAUNCH', x + 15, y + 4);
    ctx.restore();
  }

  /* ------------------------------ 破片 ------------------------------ */
  function fragPosition(f, idxF, out) {
    var n = f.path.length / 3;
    if (n < 2) { out[0] = f.landX; out[1] = 0; out[2] = f.landZ; return false; }
    var i = Math.floor(idxF);
    if (i < 0) i = 0;
    if (i >= n - 1) {
      out[0] = f.landX; out[1] = f.landed ? 0 : f.path[f.path.length - 1];
      out[2] = f.landZ;
      return false;
    }
    var u = idxF - i;
    var a = i * 3;
    out[0] = f.path[a] + (f.path[a + 3] - f.path[a]) * u;
    out[1] = f.path[a + 1] + (f.path[a + 4] - f.path[a + 1]) * u;
    out[2] = f.path[a + 2] + (f.path[a + 5] - f.path[a + 2]) * u;
    return true;
  }

  /* 终态落点密度场：运行末尾淡入，直观呈现圆形 / 椭圆 / 扇形 / 月牙 */
  function drawLandingField() {
    if (!sim || !landCells.length) return;
    var ft = time - sim.boom.t;
    if (ft < 0) return;
    var dur = sim.fragments.duration || 0;
    var a = clamp((ft - (dur - 3.5)) / 3.5, 0, 1) * 0.26;
    if (a < 0.004) return;
    var CELL = 40;
    ctx.save();
    for (var i = 0; i < landCells.length; i++) {
      var c = landCells[i];
      var p0 = project(c.x0, 0.2, c.z0);
      var p1 = project(c.x0 + CELL, 0.2, c.z0);
      var p2 = project(c.x0 + CELL, 0.2, c.z0 + CELL);
      var p3 = project(c.x0, 0.2, c.z0 + CELL);
      if (!p0.ok || !p1.ok || !p2.ok || !p3.ok) continue;
      var ac = a * Math.min(1, 0.35 + c.n / 7);
      ctx.fillStyle = 'rgba(255,146,58,' + ac.toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFragments() {
    if (!sim) return;
    var ft = time - sim.boom.t;
    if (ft < 0) return;

    var list = sim.fragments.list;
    var n = list.length;
    var i, j, k, f, idxF, p;

    // 飞行中的破片 —— 按「飞散分区 × 飞行时间」分组着色
    for (k = 0; k < 12; k++) fragGroups[k].length = 0;

    for (i = 0; i < n; i++) {
      f = list[i];
      idxF = ft / f.pathDt;
      var nPts = f.path.length / 3;
      if (idxF >= nPts - 1) continue;

      var group;
      if (ft < 0.12) group = 0;
      else if (ft < 0.5) group = 1;
      else if (ft < 1.6) group = 2;
      else group = 3;
      fragGroups[(f.zone || 0) * 4 + group].push(i);
    }

    // 尾迹：飞行初期绘制
    if (ft < 3.0) {
      var trailFade = ft < 2.2 ? 1 : Math.max(0, 1 - (ft - 2.2) / 0.8);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,186,70,' + (0.5 * trailFade).toFixed(3) + ')';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        f = list[i];
        idxF = ft / f.pathDt;
        var nPts2 = f.path.length / 3;
        if (idxF >= nPts2 - 1) continue;
        var from = Math.max(0, Math.floor(idxF) - 9);
        var started = false;
        for (j = from; j <= Math.floor(idxF); j++) {
          var a3 = j * 3;
          p = project(f.path[a3], Math.max(0, f.path[a3 + 1]), f.path[a3 + 2]);
          if (p.ok) {
            if (!started) { ctx.moveTo(p.x, p.y); started = true; }
            else ctx.lineTo(p.x, p.y);
          } else started = false;
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 破片头：弹头区偏白热，弹底区偏橙红（配色见模块级 ZONE_COLORS）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var z = 0; z < 3; z++) {
      for (k = 0; k < 4; k++) {
        var arr = fragGroups[z * 4 + k];
        if (!arr.length) continue;
        ctx.beginPath();
        for (i = 0; i < arr.length; i++) {
          f = list[arr[i]];
          idxF = ft / f.pathDt;
          fragPosition(f, idxF, tmp);
          p = project(tmp[0], tmp[1], tmp[2]);
          if (!p.ok) continue;
          var r = k === 0 ? 2.7 : (k === 1 ? 2.2 : 1.75);
          ctx.moveTo(p.x + r, p.y);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = ZONE_COLORS[z][k];
        ctx.fill();
      }
    }
    ctx.restore();

    // 落点
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      f = list[i];
      if (!f.landed) continue;
      if (ft < f.landT - sim.boom.t) continue;
      p = project(f.landX, 0.8, f.landZ);
      if (!p.ok) continue;
      var r2 = 1.15 + Math.min(2.0, (f.m / 0.028) * 1.0);
      ctx.moveTo(p.x + r2, p.y);
      ctx.arc(p.x, p.y, r2, 0, Math.PI * 2);
    }
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#ff5a3c';
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------ 爆炸 ------------------------------ */
  function drawExplosion() {
    if (!sim) return;
    var tau = time - sim.boom.t;
    if (tau < 0) return;
    var b = sim.boom;
    var p = project(b.x, b.y, b.z);
    if (!p.ok) return;
    var sx = p.x, sy = p.y;
    var scale = focal / Math.max(p.z, 40);

    // 全屏冲击白闪
    if (tau < 0.11) {
      var f0 = 1 - tau / 0.11;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,246,228,' + (0.22 * f0 * f0) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 1. 白热闪光
    if (tau < 0.55) {
      var k = tau / 0.55;
      var fade = Math.pow(1 - k, 1.6);
      var rad = Math.min((70 + 780 * Math.sqrt(k)) * scale, Math.max(W, H) * 1.15);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, rad));
      g.addColorStop(0, 'rgba(255,255,255,' + (1.0 * fade) + ')');
      g.addColorStop(0.10, 'rgba(255,247,214,' + (0.95 * fade) + ')');
      g.addColorStop(0.32, 'rgba(255,196,96,' + (0.62 * fade) + ')');
      g.addColorStop(0.66, 'rgba(255,112,32,' + (0.26 * fade) + ')');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
      ctx.restore();
    }

    // 2. 火球余晖
    if (tau < 1.7) {
      var k2 = tau / 1.7;
      var rad2 = Math.min((46 + 230 * Math.pow(k2, 0.55)) * scale, 520);
      var a2 = Math.pow(1 - k2, 1.9);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var g2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, rad2));
      g2.addColorStop(0, 'rgba(255,238,180,' + (0.9 * a2) + ')');
      g2.addColorStop(0.38, 'rgba(255,150,50,' + (0.55 * a2) + ')');
      g2.addColorStop(1, 'rgba(190,44,0,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(sx, sy, rad2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. 地面冲击波（双环）
    if (tau < 1.9) {
      var k3 = tau / 1.9;
      var r = 50 + 1150 * Math.pow(k3, 0.5);
      var aa = 0.6 * Math.pow(1 - k3, 1.5);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawGroundCircle(b.x, b.z, r, '#ffd6a0', aa, 3.4 * (1 - k3) + 0.8, []);
      drawGroundCircle(b.x, b.z, r * 0.6, '#ffa050', aa * 0.6, 2.2 * (1 - k3) + 0.5, []);
      ctx.restore();
    }

    // 4. 烟云
    if (tau < 5.0) {
      var k4 = tau / 5.0;
      ctx.save();
      for (var i = 0; i < smoke.length; i++) {
        var sm = smoke[i];
        var rise = sm.rise * Math.min(1, k4 * 1.5);
        var spread = 0.35 + k4 * 1.25;
        var q = project(b.x + sm.dx * spread, b.y + rise, b.z + sm.dz * spread);
        if (!q.ok) continue;
        var rr = (sm.r * (0.35 + k4 * 1.35)) * focal / Math.max(q.z, 40);
        rr = Math.min(rr, 240);
        if (rr < 1) continue;
        var alpha = sm.a * Math.sin(Math.min(1, k4 * 2.4) * Math.PI * 0.5) * Math.pow(1 - k4, 1.35);
        if (alpha <= 0.004) continue;
        var gg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr);
        gg.addColorStop(0, 'rgba(168,150,132,' + alpha + ')');
        gg.addColorStop(0.5, 'rgba(120,106,96,' + (alpha * 0.7) + ')');
        gg.addColorStop(1, 'rgba(80,70,64,0)');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(q.x, q.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 5. 爆点持续火光
    if (tau < 4.5) {
      var a5 = 0.22 * Math.pow(1 - tau / 4.5, 2.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var rr5 = Math.min(70 * scale, 90);
      var g5 = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, rr5));
      g5.addColorStop(0, 'rgba(255,190,110,' + a5 + ')');
      g5.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g5;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, rr5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ------------------------------ 弹丸 ------------------------------ */
  /* 旋转体网格：任意中心/朝向/投影/光源，主场景与姿态小窗共用 */
  function drawMeshBody(fr, scale, projFn, camP, light) {
    var cx0 = fr.c[0], cy0 = fr.c[1], cz0 = fr.c[2];
    var e1x = fr.e1[0], e1y = fr.e1[1], e1z = fr.e1[2];
    var e2x = fr.e2[0], e2y = fr.e2[1], e2z = fr.e2[2];
    var e3x = fr.e3[0], e3y = fr.e3[1], e3z = fr.e3[2];
    var camPX = camP[0], camPY = camP[1], camPZ = camP[2];
    var lx = light[0], ly = light[1], lz = light[2];

    var i, j, pr;

    // 投影全部网格点
    for (i = 0; i < PROF_N; i++) {
      var t = SHELL_PROFILE[i][0], r = SHELL_PROFILE[i][1];
      var u = (SHELL_CG - t) * scale;
      var ax = cx0 + e1x * u, ay = cy0 + e1y * u, az = cz0 + e1z * u;
      for (j = 0; j < RING_SEG; j++) {
        var ang = j / RING_SEG * Math.PI * 2;
        var ca = Math.cos(ang) * r * scale, sa = Math.sin(ang) * r * scale;
        var b = meshBuf[i * RING_SEG + j];
        b.wx = ax + e2x * ca + e3x * sa;
        b.wy = ay + e2y * ca + e3y * sa;
        b.wz = az + e2z * ca + e3z * sa;
        pr = projFn(b.wx, b.wy, b.wz);
        b.sx = pr.x; b.sy = pr.y; b.ok = pr.ok;
      }
    }

    // 逐面绘制：背面剔除 + 漫反射 + Blinn-Phong 高光
    for (i = 0; i < PROF_N - 1; i++) {
      var mat = SHELL_PROFILE[i][2];
      var base = MAT_RGB[mat];
      var u0 = (SHELL_CG - SHELL_PROFILE[i][0]) * scale;
      var ax0 = cx0 + e1x * u0, ay0 = cy0 + e1y * u0, az0 = cz0 + e1z * u0;

      for (j = 0; j < RING_SEG; j++) {
        var j2 = (j + 1) % RING_SEG;
        var pa = meshBuf[i * RING_SEG + j];
        var pb = meshBuf[i * RING_SEG + j2];
        var pc = meshBuf[(i + 1) * RING_SEG + j2];
        var pd = meshBuf[(i + 1) * RING_SEG + j];
        if (!pa.ok || !pb.ok || !pc.ok || !pd.ok) continue;

        // 面法向（世界系）
        var ux = pd.wx - pa.wx, uy = pd.wy - pa.wy, uz = pd.wz - pa.wz;
        var vx = pb.wx - pa.wx, vy = pb.wy - pa.wy, vz = pb.wz - pa.wz;
        var nx = uy * vz - uz * vy;
        var ny = uz * vx - ux * vz;
        var nz = ux * vy - uy * vx;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl < 1e-9) continue;
        nx /= nl; ny /= nl; nz /= nl;

        // 外法向定向
        var radx = pa.wx - ax0, rady = pa.wy - ay0, radz = pa.wz - az0;
        if (nx * radx + ny * rady + nz * radz < 0) { nx = -nx; ny = -ny; nz = -nz; }

        // 背面剔除
        var vcx = camPX - pa.wx, vcy = camPY - pa.wy, vcz = camPZ - pa.wz;
        var vcl = Math.sqrt(vcx * vcx + vcy * vcy + vcz * vcz) || 1;
        vcx /= vcl; vcy /= vcl; vcz /= vcl;
        if (nx * vcx + ny * vcy + nz * vcz <= 0.015) continue;

        var ndl = nx * lx + ny * ly + nz * lz;
        var diff = 0.24 + 0.76 * (ndl > 0 ? ndl : 0);

        var hx = lx + vcx, hy = ly + vcy, hz = lz + vcz;
        var hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
        var ndh = (nx * hx + ny * hy + nz * hz) / hl;
        var spec = ndh > 0 ? Math.pow(ndh, 18) * 0.55 : 0;

        var cr = base[0] * diff + 255 * spec;
        var cg = base[1] * diff + 255 * spec;
        var cb = base[2] * diff + 255 * spec;

        // 轮廓冷光边缘，避免暗面与背景融为一体
        var rim = 1 - (nx * vcx + ny * vcy + nz * vcz);
        rim = rim > 0 ? rim * rim * rim * 0.32 : 0;
        cr += 34 * rim;
        cg += 62 * rim;
        cb += 74 * rim;

        // 弹体纵向标识条，用于观察滚转
        if (mat === 1 && j === 0) { cr *= 0.80; cg *= 0.80; cb *= 0.80; }
        if (cr > 255) cr = 255;
        if (cg > 255) cg = 255;
        if (cb > 255) cb = 255;

        ctx.fillStyle = 'rgb(' + (cr | 0) + ',' + (cg | 0) + ',' + (cb | 0) + ')';
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.lineTo(pc.sx, pc.sy);
        ctx.lineTo(pd.sx, pd.sy);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 弹底封口
    var last = PROF_N - 1;
    if (meshBuf[last * RING_SEG].ok) {
      var bu = (SHELL_CG - SHELL_PROFILE[last][0]) * scale;
      var bcx = cx0 + e1x * bu, bcy = cy0 + e1y * bu, bcz = cz0 + e1z * bu;
      if ((-e1x) * (camPX - bcx) + (-e1y) * (camPY - bcy) + (-e1z) * (camPZ - bcz) > 0) {
        ctx.beginPath();
        for (j = 0; j < RING_SEG; j++) {
          var bp = meshBuf[last * RING_SEG + j];
          if (!bp.ok) continue;
          if (j === 0) ctx.moveTo(bp.sx, bp.sy);
          else ctx.lineTo(bp.sx, bp.sy);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgb(56,60,56)';
        ctx.fill();
      }
    }
  }

  /* 四元数 → 弹体系三轴（世界系） */
  function quatAxes(q) {
    var w = q[0], x = q[1], y = q[2], z = q[3];
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
      [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
      [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]
    ];
  }

  /* 主场景弹体：真实姿态 + 按视距自动放大，保持约 84px 可辨识尺寸 */
  function drawShellMesh(sh, scale) {
    if (!sh.quat) return;
    var a = quatAxes(sh.quat);
    drawMeshBody({ c: [sh.x, sh.y, sh.z], e1: a[0], e2: a[1], e3: a[2] },
      scale, project, [camX, camY, camZ], LIGHT_DIR);
  }

  /* 弹体姿态小窗：风轴系正交投影，清楚展示三维外形与攻角；
   * 虚线为相对空气速度方向（α/β 基准），图内标注 α=攻角、β=侧滑角及符号约定 */
  var INSET_AX = 0.30, INSET_EL = 0.34, INSET_S = 124;
  var ipOut = { x: 0, y: 0, ok: true };

  function drawBodyInset() {
    if (!sim || time > sim.flightTime || W < 560 || H < 420) return;
    var sh = shellState(time);
    if (!sh || !sh.quat) return;

    var n = sim.samples.length;
    var smp = sim.samples[clamp(Math.floor(time / sim.sampleDt), 0, n - 2)];

    // 风轴系：ex = 相对空气速度方向（与 α/β 定义同基准），ez = 世界上方向正交分量，ey = ez × ex
    var rvx = smp.rvx != null ? smp.rvx : smp.vx;
    var rvy = smp.rvy != null ? smp.rvy : smp.vy;
    var rvz = smp.rvz != null ? smp.rvz : smp.vz;
    var vl = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz) || 1;
    var exx = rvx / vl, exy = rvy / vl, exz = rvz / vl;
    var dd = exy;
    var ezx = -exx * dd, ezy = 1 - exy * dd, ezz = -exz * dd;
    var el = Math.sqrt(ezx * ezx + ezy * ezy + ezz * ezz);
    if (el < 1e-4) { ezx = 1; ezy = 0; ezz = 0; el = 1; }
    ezx /= el; ezy /= el; ezz /= el;
    var eyx = ezy * exz - ezz * exy;
    var eyy = ezz * exx - ezx * exz;
    var eyz = ezx * exy - ezy * exx;

    var qa = quatAxes(sh.quat);
    var ex = [], k;
    for (k = 0; k < 3; k++) {
      ex.push([
        qa[k][0] * exx + qa[k][1] * exy + qa[k][2] * exz,
        qa[k][0] * eyx + qa[k][1] * eyy + qa[k][2] * eyz,
        qa[k][0] * ezx + qa[k][1] * ezy + qa[k][2] * ezz
      ]);
    }

    var pw = Math.max(196, Math.min(238, W * 0.26)), ph = 172;
    var px = W - pw - 14, py = H - ph - 14;
    var cx = px + pw * 0.57, cy = py + ph * 0.52;
    var ca = Math.cos(INSET_AX), sa = Math.sin(INSET_AX);
    var cb = Math.cos(INSET_EL), sb = Math.sin(INSET_EL);

    function insetProj(wx, wy, wz) {
      var xr = ca * wx - sa * wy;
      var yr = sa * wx + ca * wy;
      ipOut.x = cx + xr * INSET_S;
      ipOut.y = cy - (yr * sb + wz * cb) * INSET_S;
      return ipOut;
    }

    // 指向观察者的方向（用于背面剔除）
    var camP = [-sa * cb * 20, -ca * cb * 20, sb * 20];

    ctx.save();

    // 面板
    ctx.fillStyle = 'rgba(4,11,17,0.82)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = 'rgba(70,211,230,0.26)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    ctx.strokeStyle = 'rgba(70,211,230,0.55)';
    ctx.beginPath();
    ctx.moveTo(px, py + 10); ctx.lineTo(px, py); ctx.lineTo(px + 10, py);
    ctx.moveTo(px + pw - 10, py); ctx.lineTo(px + pw, py); ctx.lineTo(px + pw, py + 10);
    ctx.stroke();

    // 标题与读数
    ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(126,206,222,0.85)';
    ctx.fillText('弹体姿态  BODY ATTITUDE', px + 10, py + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(120,150,160,0.8)';
    ctx.fillText('V ' + sh.speed.toFixed(0) + ' · ω ' + sh.wx.toFixed(0), px + pw - 10, py + 16);

    // 速度参考虚线（沿 +x 风轴，穿过弹轴中心）：两端伸出到弹体之外，
    // 中段被弹体网格遮挡（后绘制、不透明），避免与弹体重叠处看不清
    var v0 = insetProj(-0.68, 0, 0), v0x = v0.x, v0y = v0.y;
    var v1 = insetProj(0.44, 0, 0), v1x = v1.x, v1y = v1.y;
    ctx.strokeStyle = 'rgba(70,211,230,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(v0x, v0y);
    ctx.lineTo(v1x, v1y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 三维网格
    drawMeshBody({ c: [0, 0, 0], e1: ex[0], e2: ex[1], e3: ex[2] },
      1, insetProj, camP, [-0.42, -0.48, 0.77]);

    // 弹头前方速度箭头（与虚线同向，指明相对气流来向的行进方向）
    var a0 = insetProj(0.47, 0, 0), a0x = a0.x, a0y = a0.y;
    var a1 = insetProj(0.63, 0, 0), a1x = a1.x, a1y = a1.y;
    ctx.strokeStyle = 'rgba(120,240,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(a0x, a0y);
    ctx.lineTo(a1x, a1y);
    ctx.stroke();
    var avx = a1x - a0x, avy = a1y - a0y;
    var avl = Math.sqrt(avx * avx + avy * avy) || 1;
    var anx = -avy / avl, any = avx / avl;
    ctx.beginPath();
    ctx.moveTo(a1x, a1y);
    ctx.lineTo(a1x - avx / avl * 5.5 + anx * 2.4, a1y - avy / avl * 5.5 + any * 2.4);
    ctx.lineTo(a1x - avx / avl * 5.5 - anx * 2.4, a1y - avy / avl * 5.5 - any * 2.4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(140,245,255,0.95)';
    ctx.fill();

    // α/β 定义标注（符号约定与物理内核一致：虚线 = 相对空气速度方向）
    ctx.font = '9px "JetBrains Mono", Consolas, "Microsoft YaHei", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(110,140,152,0.85)';
    ctx.fillText('虚线 = 相对空气速度方向（α/β 基准）', px + 10, py + ph - 31);
    ctx.fillText('攻角 α+ 弹轴上抬 · 侧滑 β+ 弹轴右偏', px + 10, py + ph - 20);

    // 底部读数
    ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(140,170,180,0.85)';
    ctx.fillText('α ' + smp.alpha.toFixed(2) + '°  β ' + smp.beta.toFixed(2) + '°', px + 10, py + ph - 10);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,190,120,0.9)';
    ctx.fillText('Ma ' + smp.mach.toFixed(2), px + pw - 10, py + ph - 10);

    ctx.restore();
  }

  function drawShell() {
    if (!sim || time > sim.flightTime) return;
    var sh = shellState(time);
    if (!sh) return;

    var p = project(sh.x, sh.y, sh.z);
    if (!p.ok) return;
    var sx = p.x, sy = p.y;

    // 垂直投影虚线
    var gp = project(sh.x, 0, sh.z);
    if (gp.ok) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,220,240,0.20)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(gp.x, gp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(gp.x - 4, gp.y);
      ctx.lineTo(gp.x + 4, gp.y);
      ctx.moveTo(gp.x, gp.y - 3);
      ctx.lineTo(gp.x, gp.y + 3);
      ctx.stroke();
      ctx.restore();
    }

    // 尾迹
    var s = sim.samples;
    var idx = clamp(Math.floor(time / sim.sampleDt), 0, s.length - 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (var k = 0; k < 3; k++) {
      var from = Math.max(0, idx - 4 - k * 4);
      var to = Math.max(0, idx - k * 4);
      if (from >= to) continue;
      ctx.strokeStyle = ['rgba(120,240,255,0.55)', 'rgba(70,211,230,0.30)', 'rgba(70,211,230,0.12)'][k];
      ctx.beginPath();
      var started = false;
      for (var i = from; i <= to; i += 1) {
        var q = project(s[i].x, s[i].y, s[i].z);
        if (q.ok) {
          if (!started) { ctx.moveTo(q.x, q.y); started = true; }
          else ctx.lineTo(q.x, q.y);
        } else started = false;
      }
      ctx.stroke();
    }
    ctx.restore();

    // 三维弹体模型：按视距放大，保持弹长约 84px 的可辨识尺寸
    var dxc = sh.x - camX, dyc = sh.y - camY, dzc = sh.z - camZ;
    var cdist = Math.sqrt(dxc * dxc + dyc * dyc + dzc * dzc);
    var meshScale = 84 * cdist / (SHELL_LEN * focal);
    if (meshScale < 1) meshScale = 1;
    drawShellMesh(sh, meshScale);

    // 姿态轴（弹轴方向，放大显示）
    var qd = sh.quat;
    if (qd) {
      var qw = qd[0], qx = qd[1], qy = qd[2], qz = qd[3];
      var axX = 1 - 2 * (qy * qy + qz * qz);
      var axY = 2 * (qx * qy + qw * qz);
      var axZ = 2 * (qx * qz - qw * qy);
      var L = 26;
      var tp = project(sh.x + axX * L, sh.y + axY * L, sh.z + axZ * L);
      if (tp.ok) {
        ctx.save();
        ctx.strokeStyle = 'rgba(150,245,255,0.75)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        // 弹头三角
        var vx2 = tp.x - sx, vy2 = tp.y - sy;
        var vl = Math.sqrt(vx2 * vx2 + vy2 * vy2) || 1;
        var nx = -vy2 / vl, ny = vx2 / vl;
        ctx.beginPath();
        ctx.moveTo(tp.x, tp.y);
        ctx.lineTo(tp.x - vx2 / vl * 5 + nx * 2.6, tp.y - vy2 / vl * 5 + ny * 2.6);
        ctx.lineTo(tp.x - vx2 / vl * 5 - nx * 2.6, tp.y - vy2 / vl * 5 - ny * 2.6);
        ctx.closePath();
        ctx.fillStyle = 'rgba(180,250,255,0.9)';
        ctx.fill();
        ctx.restore();
      }
    }

    // 弹丸位置光点（真实位置标记）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 5);
    g.addColorStop(0, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.5, 'rgba(170,250,255,0.28)');
    g.addColorStop(1, 'rgba(70,211,230,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------ 屏幕装饰 ------------------------------ */
  function drawVignette() {
    ctx.save();
    var g = ctx.createRadialGradient(W2, H2, Math.min(W, H) * 0.35, W2, H2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* 主渲染                                                             */
  /* ------------------------------------------------------------------ */
  function render() {
    if (!ctx) return;

    var now = performance.now();
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0.016;
    lastFrame = now;

    updateCamera(dt);

    var horizonY = H2 - focal * Math.tan(camS.pitch);

    ctx.clearRect(0, 0, W, H);
    drawSky(horizonY);
    drawGround(horizonY);
    drawGrid();
    drawWindIndicator();
    drawLaunchMarker();
    drawLandingField();
    drawRangeRings();
    drawTrajectory();
    drawTicksOnTrajectory();
    drawFragments();
    drawExplosion();
    drawShell();
    drawVignette();
    drawBodyInset();
  }

  /* ------------------------------------------------------------------ */
  /* 数据 / 尺寸 / 交互                                                 */
  /* ------------------------------------------------------------------ */
  function setData(s) {
    sim = s;
    time = 0;
    userControl = false;
    panX = 0; panY = 0; panZ = 0;

    // 落点密度格网（终态散布形态：圆形 / 椭圆 / 扇形 / 月牙）
    landCells.length = 0;
    if (s && s.fragments) {
      var CELL = 40;
      var cellMap = {};
      var fl = s.fragments.list;
      for (var q = 0; q < fl.length; q++) {
        if (!fl[q].landed) continue;
        var gx = Math.floor(fl[q].landX / CELL);
        var gz = Math.floor(fl[q].landZ / CELL);
        var key = gx + ':' + gz;
        var cell = cellMap[key];
        if (!cell) {
          cell = { x0: gx * CELL, z0: gz * CELL, n: 0 };
          cellMap[key] = cell;
          landCells.push(cell);
        }
        cell.n++;
      }
    }

    // 烟云种子
    smoke.length = 0;
    var seed = 12345;
    function rnd() { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var i = 0; i < 9; i++) {
      smoke.push({
        dx: (rnd() - 0.5) * 190,
        dz: (rnd() - 0.5) * 190,
        rise: 30 + rnd() * 120,
        r: 32 + rnd() * 70,
        a: 0.16 + rnd() * 0.14
      });
    }

    if (s) {
      // 相机预设：全局视角开始（用户点击可切换）
      camS.tx = s.range * 0.5;
      camS.ty = s.maxAlt * 0.3;
      camS.tz = 0;
      camS.yaw = -0.55;
      camS.pitch = 0.33;
      camS.dist = s.range * 1.3;
      // 起飞后自动切到跟随
      camMode = 'follow';
    }
  }

  function setTime(t) {
    time = Math.max(0, t);
  }

  function setCameraMode(mode) {
    camMode = mode;
    userControl = false;
    panX = 0; panY = 0; panZ = 0;
    if (sim) {
      var d = desiredCamera();
      cam.yaw = d.yaw;
      cam.pitch = d.pitch;
      cam.dist = d.dist;
    }
  }

  function resize() {
    if (!canvas) return;
    // 以父容器尺寸为准（canvas 本身由 CSS 100% 撑满）；不改写 canvas.style，
    // 否则第二次 resize 会读到被锁死的像素尺寸。
    var host = canvas.parentElement;
    var cw = (host && host.clientWidth) || canvas.clientWidth || 800;
    var ch = (host && host.clientHeight) || canvas.clientHeight || 600;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, cw);
    H = Math.max(1, ch);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W2 = W / 2;
    H2 = H / 2;
    focal = H2 / Math.tan(FOV / 2);
    skyGrad = null;
    skyGradH = -1;
  }

  /* 鼠标交互：左键旋转，右键 / Shift+左键 / 中键平移，滚轮缩放 */
  var dragMode = null, lastX = 0, lastY = 0;

  function bindMouse() {
    canvas.addEventListener('mousedown', function (e) {
      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
        dragMode = 'pan';
        canvas.style.cursor = 'move';
      } else if (e.button === 0) {
        dragMode = 'orbit';
        // 与当前显示值对齐，避免首帧跳变
        cam.yaw = camS.yaw;
        cam.pitch = camS.pitch;
        canvas.style.cursor = 'grabbing';
      } else {
        return;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      userControl = true;
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragMode) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      userControl = true;

      if (dragMode === 'pan') {
        // 屏幕像素 → 世界位移：按当前视距折算
        var wpp = camS.dist / focal;
        panX += (-rtX * dx + upX * dy) * wpp;
        panY += (upY * dy) * wpp;
        panZ += (-rtZ * dx + upZ * dy) * wpp;
      } else {
        cam.yaw -= dx * 0.006;
        cam.pitch = clamp(cam.pitch + dy * 0.005, -0.02, 1.45);
      }
    });

    window.addEventListener('mouseup', function () {
      if (!dragMode) return;
      dragMode = null;
      canvas.style.cursor = 'grab';
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      userControl = true;
      var f = Math.exp(e.deltaY * 0.0011);
      cam.dist = clamp(camS.dist * f, 120, sim ? sim.range * 5 + 2000 : 60000);
      // 立即同步，避免渐进拖沓
      camS.dist = cam.dist;
      e.stopPropagation();
    }, { passive: false });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.style.cursor = 'grab';
  }

  /* ------------------------------------------------------------------ */
  function init(c) {
    canvas = c;
    ctx = canvas.getContext('2d', { alpha: false });
    resize();
    bindMouse();

    window.addEventListener('resize', resize);
    if (window.ResizeObserver) {
      try { new ResizeObserver(function () { resize(); }).observe(canvas.parentElement); } catch (err) { /* noop */ }
    }
  }

  global.Scene3D = {
    init: init,
    setData: setData,
    setTime: setTime,
    setCameraMode: setCameraMode,
    render: render,
    resize: resize,
    getCameraMode: function () { return camMode; },
    getCamera: function () {
      return {
        camX: camX, camY: camY, camZ: camZ,
        tx: camS.tx, ty: camS.ty, tz: camS.tz,
        yaw: camS.yaw, pitch: camS.pitch, dist: camS.dist,
        panX: panX, panY: panY, panZ: panZ
      };
    }
  };

})(window);
