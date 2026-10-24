/* =============================================================================
 * 120 mm 杀爆弹 — 六自由度刚体外弹道 + 动爆破片仿真内核
 * 纯 JS，无依赖，可在浏览器 / Node 中运行
 *
 * 坐标系（发射/地面系 O-xyz）：x 指向射向水平投影，y 垂直向上，z 构成右手系
 * 弹体系 O1-x1y1z1：x1 沿弹轴指前，y1 弹体上方，z1 右手
 * 状态向量 y[13] = [px,py,pz, vx,vy,vz, qw,qx,qy,qz, wx,wy,wz]
 * ========================================================================== */
(function (root) {
  'use strict';

  var G0 = 9.80665;
  var RAD2DEG = 180 / Math.PI;
  var DEG2RAD = Math.PI / 180;

  /* ------------------------------- 弹丸参数 ------------------------------- */
  var SHELL = {
    mass: 15.5,              // kg 弹丸全重
    D: 0.120,                // m 口径
    L: 0.70,                 // m 弹长
    S: Math.PI * 0.12 * 0.12 / 4, // m² 参考面积
    Ix: 0.026,               // kg·m² 极转动惯量
    Iy: 0.58,                // kg·m² 赤道转动惯量
    xcgD: 2.90,              // 质心距弹头 / 口径
    casing: 10.5,            // kg 弹体金属质量
    charge: 3.2,             // kg 装药质量
    gurney2E: 5.95e6         // (m/s)² TNT 型装药 Gurney 常数平方
  };

  /* ------------------------------- 标准大气 ------------------------------- */
  var ATM_N = 201;
  var ATM = new Array(ATM_N);
  for (var ai = 0; ai < ATM_N; ai++) {
    var ah = ai * 100;
    var aT = 288.15 - 0.0065 * ah;
    var aP = 101325 * Math.pow(aT / 288.15, 5.25588);
    ATM[ai] = { rho: aP / (287.05287 * aT), a: Math.sqrt(1.4 * 287.05287 * aT) };
  }
  function atmosphere(h) {
    if (!(h > 0)) h = 0;
    if (h > 20000) h = 20000;
    var f = h * 0.01, i = Math.floor(f), t = f - i;
    var A = ATM[i], B = ATM[i + 1 < ATM_N ? i + 1 : ATM_N - 1];
    return { rho: A.rho + (B.rho - A.rho) * t, a: A.a + (B.a - A.a) * t };
  }

  /* --------------------------- 气动系数数据表 -----------------------------
   * [Ma, Cx0, CNa(1/rad), xcp/d]
   * 120mm 旋转稳定杀爆弹的典型量级，含跨音速阻力峰
   * ---------------------------------------------------------------------- */
  var AERO = [
    [0.00, 0.150, 1.80, 3.00],
    [0.60, 0.155, 2.00, 3.05],
    [0.80, 0.180, 2.20, 3.10],
    [0.90, 0.240, 2.50, 3.20],
    [0.95, 0.330, 2.75, 3.30],
    [1.00, 0.440, 3.00, 3.45],
    [1.05, 0.500, 3.10, 3.55],
    [1.10, 0.460, 3.05, 3.60],
    [1.30, 0.370, 2.85, 3.55],
    [1.60, 0.300, 2.55, 3.45],
    [2.00, 0.255, 2.25, 3.30],
    [2.50, 0.220, 2.00, 3.15],
    [3.00, 0.200, 1.85, 3.00],
    [4.00, 0.180, 1.65, 2.85]
  ];
  function aeroAt(mach) {
    var n = AERO.length;
    if (mach <= AERO[0][0]) return AERO[0];
    if (mach >= AERO[n - 1][0]) return AERO[n - 1];
    for (var i = 0; i < n - 1; i++) {
      if (mach <= AERO[i + 1][0]) {
        var t = (mach - AERO[i][0]) / (AERO[i + 1][0] - AERO[i][0]);
        var A = AERO[i], B = AERO[i + 1];
        return [
          A[1] + (B[1] - A[1]) * t,
          A[2] + (B[2] - A[2]) * t,
          A[3] + (B[3] - A[3]) * t
        ];
      }
    }
    return AERO[n - 1];
  }

  /* ---------------------------- 六自由度导数 ------------------------------ */
  function deriv(y, out) {
    var qw = y[6], qx = y[7], qy = y[8], qz = y[9];
    var wx = y[10], wy = y[11], wz = y[12];
    var vx = y[3], vy = y[4], vz = y[5];

    var xx = qx * qx, yy = qy * qy, zz = qz * qz;
    var R00 = 1 - 2 * (yy + zz), R01 = 2 * (qx * qy - qw * qz), R02 = 2 * (qx * qz + qw * qy);
    var R10 = 2 * (qx * qy + qw * qz), R11 = 1 - 2 * (xx + zz), R12 = 2 * (qy * qz - qw * qx);
    var R20 = 2 * (qx * qz - qw * qy), R21 = 2 * (qy * qz + qw * qx), R22 = 1 - 2 * (xx + yy);

    // 速度在弹体系下的分量 (R^T * v)
    var ub = R00 * vx + R10 * vy + R20 * vz;
    var vb = R01 * vx + R11 * vy + R21 * vz;
    var wb = R02 * vx + R12 * vy + R22 * vz;

    var V2 = vx * vx + vy * vy + vz * vz;
    var V = Math.sqrt(V2) + 1e-9;

    var atm = atmosphere(y[1]);
    var mach = V / atm.a;
    var co = aeroAt(mach);
    var qd = 0.5 * atm.rho * V2;
    var S = SHELL.S, d = SHELL.D;

    var alpha = 0, beta = 0;
    if (ub > 0.2 * V) {
      alpha = Math.atan2(-vb, ub);   // 正攻角 = 弹轴抬高于速度
      beta = Math.atan2(wb, ub);
    }

    // ---- 气动力（弹体系）----
    var Cx = co[0] * (1 + 1.35 * (alpha * alpha + beta * beta));
    var CNa = co[1];
    var Fx = -qd * S * Cx;
    var Fy = qd * S * CNa * alpha;
    var Fz = qd * S * CNa * beta;

    // ---- 气动力矩（弹体系）----
    var mzA = -CNa * (co[2] - SHELL.xcgD);         // 静稳定导数（负）
    var damp = qd * S * d * d / (2 * V);            // 阻尼因子
    var magK = qd * S * d * 1.30 * (wx * d / V);    // 马格努斯 (α,β) 交叉耦合

    var Mx = 0;
    var My = qd * S * d * mzA * beta + damp * (-50.0) * wy + magK * alpha;
    var Mz = qd * S * d * mzA * alpha + damp * (-50.0) * wz - magK * beta;

    // ---- 合力转到地面系 ----
    var invM = 1 / SHELL.mass;
    var fx = (R00 * Fx + R01 * Fy + R02 * Fz) * invM;
    var fy = (R10 * Fx + R11 * Fy + R12 * Fz) * invM - G0;
    var fz = (R20 * Fx + R21 * Fy + R22 * Fz) * invM;

    // ---- 转动动力学（欧拉方程）----
    var A = SHELL.Ix, B = SHELL.Iy;
    var dwx = Mx / A;
    var dwy = (My - wx * wz * (A - B)) / B;
    var dwz = (Mz - wx * wy * (B - A)) / B;

    // ---- 状态导数 ----
    out[0] = vx; out[1] = vy; out[2] = vz;
    out[3] = fx; out[4] = fy; out[5] = fz;
    out[6] = -0.5 * (qx * wx + qy * wy + qz * wz);
    out[7] = 0.5 * (qw * wx + qy * wz - qz * wy);
    out[8] = 0.5 * (qw * wy - qx * wz + qz * wx);
    out[9] = 0.5 * (qw * wz + qx * wy - qy * wx);
    out[10] = dwx; out[11] = dwy; out[12] = dwz;
    return out;
  }

  /* ------------------------------- RK4 积分 ------------------------------- */
  var K1 = new Float64Array(13), K2 = new Float64Array(13),
      K3 = new Float64Array(13), K4 = new Float64Array(13),
      YT = new Float64Array(13);

  function rk4(y, h) {
    var i;
    deriv(y, K1);
    for (i = 0; i < 13; i++) YT[i] = y[i] + 0.5 * h * K1[i];
    deriv(YT, K2);
    for (i = 0; i < 13; i++) YT[i] = y[i] + 0.5 * h * K2[i];
    deriv(YT, K3);
    for (i = 0; i < 13; i++) YT[i] = y[i] + h * K3[i];
    deriv(YT, K4);
    for (i = 0; i < 13; i++) {
      y[i] += h * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]) / 6;
    }
    // 四元数归一化
    var n = Math.sqrt(y[6] * y[6] + y[7] * y[7] + y[8] * y[8] + y[9] * y[9]);
    if (n > 0) {
      var inv = 1 / n;
      y[6] *= inv; y[7] *= inv; y[8] *= inv; y[9] *= inv;
    }
  }

  /* --------------------------- 姿态派生量计算 ----------------------------- */
  function deriveKinematics(y, s) {
    var qw = y[6], qx = y[7], qy = y[8], qz = y[9];
    var vx = y[3], vy = y[4], vz = y[5];
    var xx = qx * qx, yy = qy * qy, zz = qz * qz;
    var R00 = 1 - 2 * (yy + zz), R01 = 2 * (qx * qy - qw * qz), R02 = 2 * (qx * qz + qw * qy);
    var R10 = 2 * (qx * qy + qw * qz), R11 = 1 - 2 * (xx + zz), R12 = 2 * (qy * qz - qw * qx);
    var R20 = 2 * (qx * qz - qw * qy), R21 = 2 * (qy * qz + qw * qx), R22 = 1 - 2 * (xx + yy);

    var V2 = vx * vx + vy * vy + vz * vz;
    var V = Math.sqrt(V2) + 1e-9;
    var ub = R00 * vx + R10 * vy + R20 * vz;
    var vb = R01 * vx + R11 * vy + R21 * vz;
    var wb = R02 * vx + R12 * vy + R22 * vz;

    var atm = atmosphere(y[1]);
    var mach = V / atm.a;
    var co = aeroAt(mach);
    var qd = 0.5 * atm.rho * V2;

    var alpha = 0, beta = 0;
    if (ub > 0.2 * V) {
      alpha = Math.atan2(-vb, ub);
      beta = Math.atan2(wb, ub);
    }

    // 弹轴方向（世界系）
    var ax = R00, ay = R10, az = R20;

    s.x = y[0]; s.y = y[1]; s.z = y[2];
    s.vx = vx; s.vy = vy; s.vz = vz;
    s.speed = V;
    s.mach = mach;
    s.alpha = alpha * RAD2DEG;
    s.beta = beta * RAD2DEG;
    s.theta = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)) * RAD2DEG; // 弹道倾角
    s.pitch = Math.asin(Math.max(-1, Math.min(1, ay))) * RAD2DEG;      // 弹轴俯仰
    s.yaw = Math.atan2(-az, ax) * RAD2DEG;
    s.wx = y[10]; s.wy = y[11]; s.wz = y[12];
    s.omega = Math.sqrt(y[10] * y[10] + y[11] * y[11] + y[12] * y[12]);
    s.qdyn = qd / 1000;   // kPa
    s.rho = atm.rho;
    s.ax = ax; s.ay = ay; s.az = az;
    s.quat = [y[6], y[7], y[8], y[9]];
    return s;
  }

  /* ------------------------------ 主仿真函数 ------------------------------ */
  /**
   * @param {Object} cfg
   *   v0        初速 m/s          (默认 450)
   *   angle     射角 deg          (默认 45)
   *   hBoom     空炸高度 m，0=触地 (默认 12)
   *   spin      初始转速 rad/s     (默认 18)
   *   windZ     横风 m/s          (默认 0)
   *   maxTime   最大仿真时间 s      (默认 120)
   *   fragCount 破片数            (默认 420)
   */
  function simulate(cfg) {
    cfg = cfg || {};
    var v0 = cfg.v0 != null ? cfg.v0 : 450;
    var ang = (cfg.angle != null ? cfg.angle : 45) * DEG2RAD;
    var hBoom = cfg.hBoom != null ? cfg.hBoom : 12;
    var spin = cfg.spin != null ? cfg.spin : 18;
    var maxT = cfg.maxTime != null ? cfg.maxTime : 140;

    var y = new Float64Array(13);
    y[0] = 0; y[1] = 0; y[2] = 0;
    y[3] = v0 * Math.cos(ang);
    y[4] = v0 * Math.sin(ang);
    y[5] = 0;
    // 弹轴与速度方向一致
    y[6] = Math.cos(ang / 2);
    y[7] = 0;
    y[8] = 0;
    y[9] = Math.sin(ang / 2);
    // 转速 + 炮口扰动（产生攻角振荡，是 6DOF 的可见特征）
    y[10] = spin;
    y[11] = 0;
    y[12] = 1.25;

    var dt = 0.001;
    var sampleDt = 0.02;
    var nextSample = 0;
    var samples = [];
    var t = 0;
    var state = {};

    var prevY = y[1];
    var prevState = null;

    samples.push(deriveKinematics(y, { t: 0 }));

    var boom = null;
    var iter = 0;
    var MAX_ITER = Math.floor(maxT / dt);

    while (iter++ < MAX_ITER) {
      // 事件检测（先保存旧值）
      var oldY = y[1];
      var oldX = y[0], oldZ = y[2];

      rk4(y, dt);
      t += dt;

      // 触发条件：下降段穿过空炸高度，或落地
      var descending = y[4] < 0;
      var trigger = (hBoom > 0.5) ? hBoom : 0;
      if (descending && oldY > trigger && y[1] <= trigger && t > 0.2) {
        // 线性插值到触发面
        var frac = (oldY - trigger) / (oldY - y[1] + 1e-12);
        frac = Math.max(0, Math.min(1, frac));
        var st = {
          t: t - dt + dt * frac,
          pos: [oldX + (y[0] - oldX) * frac, trigger, oldZ + (y[2] - oldZ) * frac],
          vel: [y[3], y[4], y[5]],
          quat: [y[6], y[7], y[8], y[9]],
          speed: Math.sqrt(y[3] * y[3] + y[4] * y[4] + y[5] * y[5])
        };
        // 用插值时刻的完整状态计算攻角
        var tmp = new Float64Array(13);
        for (var kk = 0; kk < 13; kk++) tmp[kk] = y[kk];
        tmp[0] = st.pos[0]; tmp[1] = st.pos[1]; tmp[2] = st.pos[2];
        var stk = deriveKinematics(tmp, { t: st.t });
        boom = {
          t: st.t,
          x: st.pos[0], y: st.pos[1], z: st.pos[2],
          speed: st.speed,
          vx: st.vel[0], vy: st.vel[1], vz: st.vel[2],
          quat: st.quat,
          alpha: stk.alpha,
          theta: stk.theta,
          impact: trigger < 0.5
        };
        break;
      }

      if (t >= nextSample) {
        state = deriveKinematics(y, { t: t });
        samples.push(state);
        nextSample += sampleDt;
      }

      if (!isFinite(y[0]) || y[1] < -2) break;
    }

    // 若未触发（异常保护）取最后状态
    if (!boom) {
      boom = {
        t: t, x: y[0], y: Math.max(0, y[1]), z: y[2],
        speed: Math.sqrt(y[3] * y[3] + y[4] * y[4] + y[5] * y[5]),
        vx: y[3], vy: y[4], vz: y[5], quat: [y[6], y[7], y[8], y[9]],
        alpha: 0, theta: 0, impact: true
      };
    }

    // 统计
    var maxAlt = 0, maxSpeed = 0, maxMach = 0, maxAlpha = 0, maxQ = 0;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (s.y > maxAlt) maxAlt = s.y;
      if (s.speed > maxSpeed) maxSpeed = s.speed;
      if (s.mach > maxMach) maxMach = s.mach;
      if (Math.abs(s.alpha) > maxAlpha) maxAlpha = Math.abs(s.alpha);
      if (s.qdyn > maxQ) maxQ = s.qdyn;
    }

    var mzMax = 0;
    for (var j = 0; j < samples.length; j++) if (Math.abs(samples[j].z) > mzMax) mzMax = Math.abs(samples[j].z);

    var result = {
      cfg: { v0: v0, angle: cfg.angle != null ? cfg.angle : 45, hBoom: hBoom, spin: spin },
      samples: samples,
      sampleDt: sampleDt,
      boom: boom,
      flightTime: boom.t,
      range: Math.sqrt(boom.x * boom.x + boom.z * boom.z),
      maxAlt: maxAlt,
      maxSpeed: maxSpeed,
      maxMach: maxMach,
      maxAlpha: maxAlpha,
      maxQ: maxQ,
      drift: mzMax,
      impactX: boom.x,
      impactY: boom.y,
      impactZ: boom.z
    };

    result.fragments = simulateFragments(result, cfg);
    return result;
  }

  /* ------------------------------ 破片仿真 -------------------------------- */
  function randomNormal() {
    // Box-Muller
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function quatToMatrix(q) {
    var w = q[0], x = q[1], y = q[2], z = q[3];
    var xx = x * x, yy = y * y, zz = z * z;
    return [
      [1 - 2 * (yy + zz), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (xx + zz), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (xx + yy)]
    ];
  }

  /* ---------------------- 动爆破片模型（文献模型） -------------------------
   * 1) 质量分布 —— Mott 分布
   *    N(>m) = N0·exp(-√(m/μ))，平均破片质量 = 2μ
   *    逆 CDF 采样：m = μ·[ln(1/(1-u))]²
   * 2) 初速 —— Gurney 公式 + 端部折减 + 质量相关修正
   *    v_G = √(2E·β/(1+β/2))，β = C/M
   * 3) 动爆 —— 破片静爆速度与弹丸速度矢量叠加
   *    v_b = v_s·[cosφ, sinφcosγ, sinφsinγ] + v_projectile
   *    前部破片增速、后部减速、整体飞散方向前倾
   * 4) 飞散角 φ —— 截短正态分布（膨胀壳体端部效应）
   *    弹头φ≈40°（前向锥）/ 圆柱φ≈90°（赤道带）/ 弹底φ≈140°（后向锥）
   * 5) 存速 —— 变密度大气 + 马赫相关阻力系数
   *    dv/dt = -k·|v|·v - g，k = ρ·Cd(Ma)·A/(2m)
   * 参考文献：
   *   吴巍, 王长安. 多元预制破片战斗部毁伤幅员评估方法研究[J].
   *   兵器装备工程学报, 2022, 43(S1): 113-118.
   *   Mott N F. A Theory of Fragmentation[R]. 1943.
   *   Gurney R W. The Initial Velocities of Fragments from Bombs,
   *   Shells and Grenades[R]. BRL Report 405, 1943.
   * ---------------------------------------------------------------------- */
  var FRAG_ZONES = [
    // φ 均值(°) φ 标准差  质量因子  初速因子  质量权重
    { phi: 42, sig: 13, mf: 0.72, vf: 1.04, w: 0.16 },  // 弹头：前向锥，碎块小
    { phi: 90, sig: 17, mf: 1.00, vf: 1.00, w: 0.74 },  // 圆柱：赤道带
    { phi: 139, sig: 15, mf: 1.55, vf: 0.94, w: 0.10 }  // 弹底：后向锥，大块
  ];

  /* 不规则破片阻力系数（随马赫数） */
  function fragCd(mach) {
    if (mach < 0.6) return 1.02;
    if (mach < 1.05) return 1.02 + 0.40 * (mach - 0.6) / 0.45;
    if (mach < 2.0) return 1.42 - 0.14 * (mach - 1.05);
    return 1.29;
  }

  /* Mott 分布逆采样 */
  function sampleMottMass(mu) {
    var u = Math.random();
    if (u > 0.9994) u = 0.9994;
    var l = Math.log(1 / (1 - u));
    return mu * l * l;
  }

  function simulateFragments(sim, cfg) {
    var N = Math.max(50, Math.min(2000, (cfg && cfg.fragCount) || 420));
    var boom = sim.boom;
    var R = quatToMatrix(boom.quat);

    // Gurney 初速
    var betaG = SHELL.charge / SHELL.casing;
    var vG = Math.sqrt(SHELL.gurney2E * betaG / (1 + betaG / 2)); // ≈1254 m/s

    // Mott 特征质量：μ = 平均质量 / 2
    var meanM = SHELL.casing / N;
    var mu = meanM / 2;

    var dt = 0.01;
    var sampleDt = 0.02;
    var maxFlight = 60;

    var i, k, s;

    /* ---- 1) 质量抽样（Mott 逆 CDF）+ 端部分区 ---- */
    var masses = new Array(N);
    var zones = new Array(N);
    var axialU = new Array(N);
    var sumM = 0;

    for (i = 0; i < N; i++) {
      var zr = Math.random(), zi = 0, acc = 0;
      for (k = 0; k < FRAG_ZONES.length; k++) {
        acc += FRAG_ZONES[k].w;
        if (zr <= acc) { zi = k; break; }
      }
      var zone = FRAG_ZONES[zi];
      var m = sampleMottMass(mu) * zone.mf;
      m = Math.max(meanM * 0.05, Math.min(meanM * 8, m));
      masses[i] = m;
      zones[i] = zi;
      // 轴向位置 u ∈ [-1,1]，正方向指向弹头
      if (zi === 0) axialU[i] = 0.55 + 0.45 * Math.random();
      else if (zi === 2) axialU[i] = -0.55 - 0.45 * Math.random();
      else axialU[i] = (Math.random() * 2 - 1) * 0.55;
      sumM += m;
    }
    // 质量守恒归一化到弹体金属质量
    var mScale = SHELL.casing / sumM;
    for (i = 0; i < N; i++) masses[i] *= mScale;

    /* ---- 2) 逐破片六分量外弹道 ---- */
    var frags = [];
    var effectiveCount = 0, totalEnergy = 0, maxRadius = 0, killCount = 0, landedCount = 0;
    var forwardMax = -1e9, backMin = 1e9, lateralMax = 0;
    var zoneCount = [0, 0, 0];

    for (i = 0; i < N; i++) {
      var mass = masses[i];
      var zone2 = FRAG_ZONES[zones[i]];
      zoneCount[zones[i]]++;

      // 飞散角 φ（相对弹轴，0°=弹头方向）：截短正态
      var phi = (zone2.phi + randomNormal() * zone2.sig) * DEG2RAD;
      if (phi < 8 * DEG2RAD) phi = 8 * DEG2RAD;
      if (phi > 172 * DEG2RAD) phi = 172 * DEG2RAD;
      var gamma = Math.random() * Math.PI * 2;

      // Gurney 端部折减：越靠近端部初速越低
      var u = axialU[i];
      var axial = Math.sqrt(Math.max(0.55, 1 - 0.22 * u * u));

      // 小破片初速略高（当地装填比更高）
      var vRel = vG * axial * zone2.vf * Math.pow(meanM / mass, 0.13) * (1 + 0.07 * randomNormal());
      if (vRel < 200) vRel = 200;

      var sinP = Math.sin(phi), cosP = Math.cos(phi);
      var dl0 = cosP, dl1 = sinP * Math.cos(gamma), dl2 = sinP * Math.sin(gamma);

      // 弹体系 → 世界系
      var dxw = R[0][0] * dl0 + R[0][1] * dl1 + R[0][2] * dl2;
      var dyw = R[1][0] * dl0 + R[1][1] * dl1 + R[1][2] * dl2;
      var dzw = R[2][0] * dl0 + R[2][1] * dl1 + R[2][2] * dl2;

      // 动爆：弹丸速度矢量叠加
      var vx = boom.vx + dxw * vRel;
      var vy = boom.vy + dyw * vRel;
      var vz = boom.vz + dzw * vRel;

      var px = boom.x, py = boom.y, pz = boom.z;

      // 迎风面积 ~ m^(2/3)，不规则形状因子 1.45
      var Aref = Math.pow(mass / 7850, 2 / 3) * 1.45;

      var path = [];
      var tt = 0;
      var nextS = 0;
      var landed = false;
      var landX = 0, landZ = 0, landV = 0, landT = 0;

      var steps = Math.floor(maxFlight / dt);
      for (s = 0; s < steps; s++) {
        if (tt >= nextS) {
          path.push(px, py, pz);
          nextS += sampleDt;
        }
        var pxPrev = px, pyPrev = py, pzPrev = pz;

        // 变密度大气 + 马赫相关 Cd，RK2 中点法
        var sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        var atm = atmosphere(py);
        var kd = 0.5 * atm.rho * fragCd(sp / atm.a) * Aref / mass;

        var ax1 = -kd * sp * vx;
        var ay1 = -kd * sp * vy - G0;
        var az1 = -kd * sp * vz;
        var mvx = vx + ax1 * dt * 0.5;
        var mvy = vy + ay1 * dt * 0.5;
        var mvz = vz + az1 * dt * 0.5;
        var sp2 = Math.sqrt(mvx * mvx + mvy * mvy + mvz * mvz);
        vx += -kd * sp2 * mvx * dt;
        vy += (-kd * sp2 * mvy - G0) * dt;
        vz += -kd * sp2 * mvz * dt;
        px += vx * dt; py += vy * dt; pz += vz * dt;
        tt += dt;

        if (py <= 0 && pyPrev > 0) {
          var ff = pyPrev / (pyPrev - py + 1e-12);
          ff = ff < 0 ? 0 : (ff > 1 ? 1 : ff);
          landX = pxPrev + (px - pxPrev) * ff;
          landZ = pzPrev + (pz - pzPrev) * ff;
          landV = Math.sqrt(vx * vx + vy * vy + vz * vz);
          landT = boom.t + tt - dt * (1 - ff);
          landed = true;
          px = landX; py = 0; pz = landZ;
          break;
        }
      }

      if (!landed) {
        landX = px; landZ = pz; landV = Math.sqrt(vx * vx + vy * vy + vz * vz); landT = boom.t + tt;
      }
      path.push(px, Math.max(0, py), pz);

      var ddx = landX - boom.x;
      var ddz = landZ - boom.z;
      var radius = Math.sqrt(ddx * ddx + ddz * ddz);
      var energy = landed ? 0.5 * mass * landV * landV : 0;
      if (landed) {
        totalEnergy += energy;
        landedCount++;
        if (energy > 78) killCount++;     // 78 J 人员致伤阈值量级
        if (landV > 100) effectiveCount++;
        if (radius > maxRadius) maxRadius = radius;
        if (ddx > forwardMax) forwardMax = ddx;
        if (ddx < backMin) backMin = ddx;
        if (Math.abs(ddz) > lateralMax) lateralMax = Math.abs(ddz);
      }

      frags.push({
        m: mass,
        v0: vRel,
        zone: zones[i],
        path: path,
        pathDt: sampleDt,
        landed: landed,
        landX: landX,
        landZ: landZ,
        landT: landT,
        landV: landV,
        energy: energy,
        radius: radius
      });
    }

    // 散布统计（仅统计已落地破片）
    var landedFrags = frags.filter(function (f) { return f.landed; });
    var maxLandT = 0;
    for (i = 0; i < landedFrags.length; i++) {
      var lt = landedFrags[i].landT - boom.t;
      if (lt > maxLandT) maxLandT = lt;
    }
    var rs = landedFrags.map(function (f) { return f.radius; }).sort(function (a, b) { return a - b; });
    var r50 = rs[Math.floor(rs.length * 0.5)] || 0;
    var r90 = rs[Math.floor(rs.length * 0.9)] || 0;
    var avgLandV = landedFrags.length
      ? landedFrags.reduce(function (a, f) { return a + f.landV; }, 0) / landedFrags.length : 0;
    var maxFragM = 0, meanFragM = 0;
    for (i = 0; i < N; i++) {
      meanFragM += frags[i].m;
      if (frags[i].m > maxFragM) maxFragM = frags[i].m;
    }
    meanFragM /= N;

    return {
      list: frags,
      vGurney: vG,
      count: N,
      landedCount: landedCount,
      maxRadius: maxRadius,
      r50: r50,
      r90: r90,
      avgLandV: avgLandV,
      totalEnergy: totalEnergy,
      killCount: killCount,
      mu: mu,
      meanMass: meanFragM,
      maxMass: maxFragM,
      zoneCount: zoneCount,
      forwardMax: forwardMax > -1e8 ? forwardMax : 0,
      backMin: backMin < 1e8 ? backMin : 0,
      lateralMax: lateralMax,
      duration: maxLandT,
      unlanded: N - landedCount
    };
  }

  /*__VERIFY_INTERNALS__*/
root.__internals = { missing: [] };
(function () {
  var names = ["deriv","rk4","atmosphere","aeroAt","AERO","ATM","ATM_N","SHELL","G0","deriveKinematics","simulateFragments","sampleMottMass","randomNormal","quatToMatrix","FRAG_ZONES","fragCd","simulate","REPORT","SHELL_CFG"];
  for (var ii = 0; ii < names.length; ii++) {
    try {
      var vv = eval(names[ii]);
      if (vv !== undefined) root.__internals[names[ii]] = vv; else root.__internals.missing.push(names[ii]);
    } catch (e) { root.__internals.missing.push(names[ii]); }
  }
})();
/* ------------------------------ 导出接口 -------------------------------- */
  var Ballistics = {
    SHELL: SHELL,
    simulate: simulate,
    atmosphere: atmosphere,
    aeroAt: aeroAt,
    deriveKinematics: deriveKinematics,
    quatToMatrix: quatToMatrix
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Ballistics;
  root.Ballistics = Ballistics;

})(typeof window !== 'undefined' ? window : globalThis);

/* verify: native require 暴露内部函数 */
if (typeof module !== 'undefined' && module.exports) module.exports.__internals = globalThis.__internals;
