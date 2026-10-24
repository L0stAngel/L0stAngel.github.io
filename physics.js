/* =============================================================================
 * 120 mm 杀爆弹 — 六自由度刚体外弹道 + 动爆破片仿真内核
 * 纯 JS，无依赖，可在浏览器 / Node 中运行
 *
 * 坐标系（发射/地面系 O-xyz）：x 指向射向水平投影，y 垂直向上，z 构成右手系
 * 说明：本文件采用"弹道系"约定 —— x 为射向水平投影，y 向上，z 为射向右侧。
 * 弹体系 O1-x1y1z1：x1 沿弹轴指前，y1 弹体上方，z1 右手
 * 状态向量 y[15] =
 *   [ px,py,pz, vx,vy,vz, qw,qx,qy,qz, wx,wy,wz, zCor, vCor ]
 *   zCor / vCor 为科氏力单独引起的侧向位移/速度（诊断量，不参与气动力）
 *
 * 主要升级（相对初版）：
 *   1. ISA 分层标准大气（0–32 km，含温度偏移灵敏度）
 *   2. 风场（横风/纵风 + 幂律高度剖面，气动力用相对风速）
 *   3. 地球自转科氏力（纬度/射向可调）
 *   4. 真实自转：由膛线缠距换算炮口转速，并计滚转阻尼衰减
 *   5. 六自由度气动模型：非线性法向力、俯仰阻尼、滚转阻尼、Magnus 力/力矩
 *   6. 炮口扰动初始姿态（跳角 + 横向角速度），产生进动/章动
 *   7. 事件插值起爆/落点，陀螺稳定因子等诊断量
 *   8. 破片：Mott 质量分布 + Gurney 初速 + 自转切向速度 + 风场存速
 *
 * 主要参考文献：
 *   [1] McCoy R L. Modern Exterior Ballistics: The Launch and Flight Dynamics
 *       of Symmetric Projectiles[M]. 2nd ed. Atglen: Schiffer Publishing, 2012.
 *       （6-DOF 方程、BRL 气动系数、陀螺稳定因子、翻转/俯仰阻尼/Magnus 力矩）
 *   [2] McCoy R L. Tabulated Aerodynamic Characteristics of the 105mm, M1
 *       Projectile. Appendix B of [1], pp.218-219 — 本文气动系数表来源。
 *   [3] Mott N F, Linfoot E H. A Theory of Fragmentation. 1943; reprinted in:
 *       Grady D (ed). Fragmentation of Rings and Shells. Springer, 2006:
 *       207-225. DOI 10.1007/978-3-540-27145-1_9
 *   [4] Gurney R W. The Initial Velocities of Fragments from Bombs, Shells and
 *       Grenades[R]. BRL Report 405, 1943. DOI 10.21236/ADA800105
 *   [5] 李昆, 等. 浇注 PBX 装药爆炸壳体破片分布特性[J]. 科学技术与工程,
 *       2023, 23(17): 7335-7340. DOI 10.12404/j.issn.1671-1815.2023.23.17.07335
 *       （"破片动能 >78 J 为杀伤破片"的中文出处；80 J 另见 Rettinger 2017）
 *   [6] ISO 2533:1975 Standard Atmosphere；GB/T 45846-2025《标准大气》
 *       （2025-10-01 实施，采标 ISO；替代 GB 1920-80 引用）
 *   [7] Orłowski M, et al. 120mm HE mortar fragmentation studies, Part I/II[J].
 *       Problemy Techniki Uzbrojenia, 2024, 169(2): 7-27 / 170(3): 39-64.
 *       DOI 10.5604/01.3001.0054.6650 / 10.5604/01.3001.0054.7454
 *       （120mm 迫弹真实破碎弹道试验；本文破片参数为工程设定，未直接取用）
 * ========================================================================== */
(function (root) {
  'use strict';

  var G0 = 9.80665;                 // 标准重力加速度 m/s²
  var OMEGA_E = 7.292115e-5;        // 地球自转角速度 rad/s
  var R_EARTH = 6371000;            // 地球平均半径 m
  var RAD2DEG = 180 / Math.PI;
  var DEG2RAD = Math.PI / 180;

  /* ------------------------------- 弹型预设 -------------------------------
   * 预设 A（默认）：120 mm 迫弹 —— 尾翼稳定、全程不旋转
   *   质量/惯量取自 McCoy 表 9.5（M934/M930/M929 平均）；
   *   气动系数取自 McCoy 附录 C（BRL-MR-3884 自由飞试验）；
   *   验证基准：McCoy 表 9.7（v0=102/318 m/s，QE=45/65/85°）。
   * 预设 B：120 mm 杀爆弹（旋转稳定代表弹）—— 线膛炮发射
   *   质量/惯量为同类弹工程估算；气动系数按 McCoy 附录 B 的 105 mm HE M1
   *   同类弹换算（无 120 mm 旋转弹实测数据，明确标注为估算）；
   *   内核验证：以 105 mm M1 参数代入复现 McCoy 例 9.2（4 组）。
   * ---------------------------------------------------------------------- */
  var SHELL_MORTAR120 = {
    mass: 13.585,                     // kg 弹丸全重（McCoy 表 9.5）
    D: 0.11956,                       // m 参考直径
    L: 0.7049,                        // m 弹长
    S: Math.PI * 0.11956 * 0.11956 / 4,
    Ix: 0.02335,                      // kg·m² 极转动惯量（McCoy 表 9.5）
    Iy: 0.23187,                      // kg·m² 赤道转动惯量（McCoy 表 9.5）
    xcgD: (0.7049 - 0.4229) / 0.11956,// 质心距弹尖 / 口径 = 2.36（McCoy 表 9.5）
    casing: 9.5,                      // kg 壳体金属质量（工程估算，公开数据缺失）
    charge: 1.9,                      // kg 装药质量（工程估算 → β≈0.20）
    gurney2E: 5.95e6,                 // (m/s)² TNT 型装药 √2E≈2440 m/s
    twist: 0,                         // 尾翼稳定、不旋转（McCoy p.207 原文）
    wallR: 0.054,                     // m 破片起始半径
    fragDensity: 7850,
    spinMode: 'none',
    aeroSource: 'McCoy App.C (120mm mortar, BRL-MR-3884)',
    presetName: '120mm 迫弹（尾翼稳定·不旋转）'
  };

  var SHELL_SPIN120 = {
    mass: 15.5,                       // kg 弹丸全重（同类弹估算）
    D: 0.120,                         // m 口径
    L: 0.70,                          // m 弹长
    S: Math.PI * 0.120 * 0.120 / 4,
    Ix: 0.0266,                       // kg·m² 极转动惯量（按 McCoy 120mm 弹数据换算）
    Iy: 0.2646,                       // kg·m² 赤道转动惯量（按 McCoy 120mm 弹数据换算）
    xcgD: 2.90,                       // 质心距弹尖 / 口径（同类弹估算）
    casing: 10.5,                     // kg 壳体金属质量（工程估算）
    charge: 3.2,                      // kg 装药质量（工程估算）
    gurney2E: 5.95e6,
    twist: 18,                        // 膛线缠距，口径/转（右旋）
    wallR: 0.052,
    fragDensity: 7850,
    spinMode: 'rifled',
    aeroSource: 'McCoy App.B (105mm M1 surrogate, estimated for 120mm)',
    presetName: '120mm 杀爆弹（旋转稳定代表弹）'
  };

  /* --------------------------- 气动系数数据表 -----------------------------
   * BRL 气动命名法（McCoy 2012, 第 9 章 + 附录 B/C）：
   *   C_D  = C_D0 + C_Dδ2·sin²αt
   *   C_N  = (C_Nα0 + C_Nα2·sin²αt)·sinαt
   *   C_Mα = (C_Mα0 + C_Mα2·sin²αt)      （正 = 翻转/静不稳定；负 = 静稳定）
   *   C_Mq+C_Mα̇ = (…)0 + (…)2·sin²αt     （俯仰阻尼，BRL 归一）
   *   C_lp : 滚转阻尼；C_Mpα/C_Npα : Magnus 力矩/力（旋转弹）
   * 表列形式 [Ma, 系数值]，线性插值，Ma 超出表范围取端值。
   * ---------------------------------------------------------------------- */
  /* 附录 C：120mm 迫弹（尾翼稳定、不旋转；Ma ≤ 0.95） */
  var AERO_MORTAR120 = {
    CD0: [[0, 0.119], [0.7, 0.119], [0.85, 0.120], [0.87, 0.122],
          [0.90, 0.126], [0.93, 0.148], [0.95, 0.182]],
    CD2: [[0, 2.32], [0.4, 2.44], [0.6, 2.66], [0.7, 2.87], [0.75, 3.01],
          [0.85, 3.55], [0.90, 4.03], [0.95, 5.20]],
    CNa0: [[0, 1.75], [0.6, 1.95], [0.8, 2.02], [0.9, 2.06], [0.95, 2.08]],
    CNa2: [[0, 14.8], [0.5, 14.8], [0.6, 4.5], [0.63, 1.4], [0.7, 0.4],
           [0.8, 8.8], [0.9, 28.3], [0.95, 40.0]],
    CMa0: [[0, -0.02], [0.4, -1.02], [0.6, -1.62], [0.8, -2.41],
           [0.9, -2.72], [0.92, -2.75], [0.95, -2.71]],
    CMa2: [[0, -15.1], [0.45, -15.1], [0.6, -12.7], [0.7, -8.5],
           [0.75, -4.5], [0.8, 1.5], [0.85, 13.9], [0.9, 30.2], [0.95, 59.9]],
    Cmq0: [[0, -22.0], [0.8, -21.1], [0.85, -21.9], [0.9, -24.2],
           [0.92, -26.8], [0.95, -31.5]],
    Cmq2: [[0, 48], [0.5, -46], [0.6, -86], [0.7, -144], [0.8, -259],
           [0.85, -357], [0.9, -468], [0.95, -745]]
  };

  /* 附录 B：105mm HE M1（旋转稳定；120mm 代表弹按同类弹形换算） */
  var AERO_SPIN120 = {
    CD0: [[0, 0.124], [0.875, 0.124], [0.925, 0.150], [0.965, 0.200], [0.990, 0.350],
          [1.025, 0.375], [1.085, 0.415], [1.19, 0.415], [1.35, 0.385],
          [1.80, 0.335], [2.0, 0.318], [2.5, 0.276]],
    CD2: [[0, 3.2], [0.88, 3.2], [0.97, 6.3], [0.99, 4.0], [1.15, 5.0],
          [1.25, 5.4], [1.30, 5.5], [2.1, 5.5], [2.5, 5.5]],
    CNa0: [[0, 1.63], [0.4, 1.63], [0.7, 1.41], [0.89, 1.22], [0.99, 1.73],
           [1.09, 1.57], [1.5, 1.97], [2.0, 2.25], [2.5, 2.50]],
    CNa2: [[0, 0.1], [0.2, 0.1], [0.6, 3.5], [0.8, 6.6], [0.985, 9.2],
           [1.09, 8.8], [1.3, 12.0], [1.5, 13.7], [2.0, 16.0], [2.5, 17.0]],
    CMa0: [[0, 3.55], [0.46, 3.55], [0.61, 3.76], [0.78, 3.92], [0.87, 3.96],
           [0.925, 4.85], [0.97, 4.0], [1.09, 3.83], [1.5, 3.75], [2.5, 3.75]],
    CMa2: [[0, -2.9], [0.4, -2.9], [0.45, -3.1], [0.65, -4.4], [0.78, -3.45],
           [0.885, -1.78], [0.98, -3.0], [1.075, -2.1], [1.25, -3.325],
           [1.5, -4.45], [2.0, -4.6], [2.5, -4.6]],
    Cmq0: [[0, -3.15], [0.79, -3.15], [1.15, -9.1], [1.55, -9.5]],
    Clp: [[0, -0.0178], [0.43, -0.0149], [0.70, -0.0135], [0.91, -0.0126],
          [0.99, -0.0110], [1.09, -0.0101], [1.5, -0.0094], [2.0, -0.0087],
          [2.5, -0.0087]],
    CMp: [[0, 0.10], [0.22, 0.10], [0.31, 0.10], [0.48, -0.46], [0.81, -0.46],
          [0.87, 0.4175], [0.92, 0.4175], [0.96, 0.3747], [0.995, 0.3747],
          [1.02, 0.20], [1.1, 0.20], [1.21, 0.193], [1.28, 0.193],
          [1.46, 0.215], [1.55, 0.215]],
    CNp: [[0, -0.34], [0.22, -0.34], [0.31, -0.125], [0.48, -0.34],
          [0.999, -0.34], [1.001, -0.36], [1.55, -0.36]]
  };

  var PRESETS = {
    mortar120: {
      id: 'mortar120',
      name: SHELL_MORTAR120.presetName,
      shell: SHELL_MORTAR120,
      aero: AERO_MORTAR120,
      defaults: { v0: 318, angle: 45, twist: 0, wz0: 1.795, wy0: 0,
        jump: 0, yaw0: 0, fragCount: 800, v0Min: 250, v0Max: 340, angleMax: 85 }
    },
    spin120: {
      id: 'spin120',
      name: SHELL_SPIN120.presetName,
      shell: SHELL_SPIN120,
      aero: AERO_SPIN120,
      defaults: { v0: 450, angle: 45, twist: 18, wz0: 1.60, wy0: 0.40,
        jump: 0.15, yaw0: 0.035, fragCount: 800, v0Min: 250, v0Max: 550, angleMax: 70 }
    }
  };

  var PRESET_NAME = 'mortar120';
  var SHELL = {};
  var TAB = AERO_MORTAR120;

  function applyPreset(name) {
    var p = PRESETS[name] || PRESETS.mortar120;
    var k;
    for (k in SHELL) if (Object.prototype.hasOwnProperty.call(SHELL, k)) delete SHELL[k];
    for (k in p.shell) SHELL[k] = p.shell[k];
    TAB = p.aero;
    PRESET_NAME = p.id;
    return p;
  }
  applyPreset(PRESET_NAME);

  /* 气动模型开关与常量 */
  var AERO_C = {
    useMagnusForce: false,  // Magnus 力（量级小，默认关闭）
    useMagnusMoment: true,  // Magnus 力矩（旋转弹偏流/极限环，必须保留）
    useNonlinear: true      // 大攻角非线性（CNa2 / CD2 / CMa2 / Cmq2）
  };

  function interpTab(tab, x) {
    var n = tab.length;
    if (!(x > tab[0][0])) return tab[0][1];
    if (x >= tab[n - 1][0]) return tab[n - 1][1];
    for (var i = 0; i < n - 1; i++) {
      if (x <= tab[i + 1][0]) {
        var t = (x - tab[i][0]) / (tab[i + 1][0] - tab[i][0]);
        return tab[i][1] + (tab[i + 1][1] - tab[i][1]) * t;
      }
    }
    return tab[n - 1][1];
  }

  /* 兼容旧接口：返回 [C_D0, C_Nα, 压心估计, C_Mα0] */
  function aeroAt(mach) {
    var cd0 = interpTab(TAB.CD0, mach);
    var cna = interpTab(TAB.CNa0, mach);
    var cma = interpTab(TAB.CMa0, mach);
    var cp = SHELL.xcgD - cma / Math.max(Math.abs(cna), 1e-6);
    return [cd0, cna, cp, cma];
  }

  /* ------------------------------ 标准大气 -------------------------------
   * ISA 分层公式：对流层 0–11 km、平流层 11–20 km、20–32 km，
   * 表 0–32 km 每 100 m 一点，线性插值（插值误差 < 0.05%）。
   * 温度偏移 dT 时按 ρ = p/(R·T) 修正（工程灵敏度近似，气压取标准值）。
   * 依据 ISO 2533:1975 / GB 1920-80。
   * ---------------------------------------------------------------------- */
  var R_AIR = 287.05287, GAMMA_AIR = 1.4;
  var ATM_N = 321;
  var ATM = new Array(ATM_N);

  function isaBase(h) {
    var T, p;
    if (h < 11000) {
      T = 288.15 - 0.0065 * h;
      p = 101325 * Math.pow(T / 288.15, 5.255877);
    } else if (h < 20000) {
      T = 216.65;
      p = 22632.06 * Math.exp(-G0 * (h - 11000) / (R_AIR * 216.65));
    } else {
      T = 216.65 + 0.001 * (h - 20000);
      p = 5474.89 * Math.pow(T / 216.65, -34.1632);
    }
    return { T: T, p: p, rho: p / (R_AIR * T), a: Math.sqrt(GAMMA_AIR * R_AIR * T) };
  }
  for (var ai = 0; ai < ATM_N; ai++) ATM[ai] = isaBase(ai * 100);

  function atmosphere(h, dT, out) {
    if (!(h > 0)) h = 0;
    if (h > 32000) h = 32000;
    var f = h * 0.01, i = Math.floor(f), t = f - i;
    if (i >= ATM_N - 1) { i = ATM_N - 2; t = 1; }   // 顶层边界取 32 km 表值
    var A = ATM[i], B = ATM[i + 1];
    var T = A.T + (B.T - A.T) * t;
    var p = A.p + (B.p - A.p) * t;
    if (out) {
      // 热路径复用调用方缓冲，避免每次调用分配对象
      out.T = T; out.p = p;
      if (dT) {
        T += dT;
        out.T = T;
        out.rho = p / (R_AIR * T);
        out.a = Math.sqrt(GAMMA_AIR * R_AIR * T);
      } else {
        out.rho = A.rho + (B.rho - A.rho) * t;
        out.a = A.a + (B.a - A.a) * t;
      }
      return out;
    }
    if (dT) {
      T += dT;
      return { T: T, p: p, rho: p / (R_AIR * T), a: Math.sqrt(GAMMA_AIR * R_AIR * T) };
    }
    return {
      T: T, p: p,
      rho: A.rho + (B.rho - A.rho) * t,
      a: A.a + (B.a - A.a) * t
    };
  }

  /* ------------------------------- 环境默认值 ---------------------------- */
  var ENV_DEFAULT = {
    tempC: 15,        // 海平面气温 °C（ISA 15°C），仅作温度偏移灵敏度
    latitude: 40,     // 纬度 °（北纬正），取 40°N 代表中纬度
    azimuth: 0,       // 射向方位角 °（0 = 正北，90 = 正东）
    windCross: 0,     // 横风 m/s，+ 为吹向弹道右侧
    windHead: 0,      // 纵风 m/s，+ 为逆风（迎面）
    windRefH: 10,     // 风速参考高度 m
    windPower: 0.143, // 幂律风剖面指数（开阔地 ≈ 1/7）
    useCoriolis: true,
    useWind: true
  };

  /* --------------------------- 运行上下文（模块内共享）------------------- */
  var CUR = {
    dT: 0,
    useWind: true, useCoriolis: true,
    windHead: 0, windCross: 0, windPower: 0.143, windRefH: 10,
    omgX: 0, omgY: 0, omgZ: 0
  };

  /* atmosphere() 热路径复用缓冲（deriv / deriveKinematics / fragAccel 各自独立） */
  var ATMO_DERIV = { T: 0, p: 0, rho: 0, a: 0 };
  var ATMO_KIN = { T: 0, p: 0, rho: 0, a: 0 };
  var ATMO_FRAG = { T: 0, p: 0, rho: 0, a: 0 };

  function setEnv(env) {
    env = env || {};
    var e = {
      tempC: env.tempC != null ? env.tempC : ENV_DEFAULT.tempC,
      latitude: env.latitude != null ? env.latitude : ENV_DEFAULT.latitude,
      azimuth: env.azimuth != null ? env.azimuth : ENV_DEFAULT.azimuth,
      windCross: env.windCross != null ? env.windCross : ENV_DEFAULT.windCross,
      windHead: env.windHead != null ? env.windHead : ENV_DEFAULT.windHead,
      windRefH: env.windRefH != null ? env.windRefH : ENV_DEFAULT.windRefH,
      windPower: env.windPower != null ? env.windPower : ENV_DEFAULT.windPower,
      useCoriolis: env.useCoriolis !== false,
      useWind: env.useWind !== false
    };
    CUR.dT = e.tempC - 15;
    CUR.useWind = e.useWind;
    CUR.useCoriolis = e.useCoriolis;
    CUR.windHead = e.windHead;
    CUR.windCross = e.windCross;
    CUR.windPower = e.windPower;
    CUR.windRefH = e.windRefH;
    var phi = e.latitude * DEG2RAD, A = e.azimuth * DEG2RAD;
    CUR.omgX = OMEGA_E * Math.cos(phi) * Math.cos(A);
    CUR.omgY = OMEGA_E * Math.sin(phi);
    CUR.omgZ = -OMEGA_E * Math.cos(phi) * Math.sin(A);
    return e;
  }

  /* 幂律风剖面：w(h) = w10·(h/10)^α，近地按 2 m 处理（工程近似） */
  function windProfile(h) {
    var hr = CUR.windRefH > 0 ? CUR.windRefH : 10;
    var hh = h > 2 ? h : 2;
    var f = Math.pow(hh / hr, CUR.windPower);
    return f;
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

    // 相对空气速度（风速随高度变化）
    var rvx = vx, rvy = vy, rvz = vz;
    if (CUR.useWind && (CUR.windCross !== 0 || CUR.windHead !== 0)) {
      var wf = windProfile(y[1]);
      rvx += CUR.windHead * wf;   // 纵风 + 为逆风（吹向 -x）
      rvz -= CUR.windCross * wf;
    }

    // 相对速度在弹体系下的分量 (R^T·v_rel)
    var ub = R00 * rvx + R10 * rvy + R20 * rvz;
    var vb = R01 * rvx + R11 * rvy + R21 * rvz;
    var wb = R02 * rvx + R12 * rvy + R22 * rvz;

    var V2 = rvx * rvx + rvy * rvy + rvz * rvz;
    var V = Math.sqrt(V2) + 1e-9;

    var atm = atmosphere(y[1], CUR.dT, ATMO_DERIV);
    var mach = V / atm.a;
    var qd = 0.5 * atm.rho * V2;
    var S = SHELL.S, d = SHELL.D;

    var alpha = 0, beta = 0, alphaT = 0, sinAt = 0;
    if (ub > 0.15 * V) {
      alpha = Math.atan2(-vb, ub);   // 正攻角 = 弹轴抬高于相对风速
      beta = Math.atan2(-wb, ub);    // 正偏航角 = 弹轴偏向相对风速右侧
      alphaT = Math.sqrt(alpha * alpha + beta * beta);
      sinAt = Math.sqrt(vb * vb + wb * wb) / V;
    }
    var sa2 = sinAt * sinAt;

    // ---- 气动力（弹体系，BRL/McCoy 系数表）----
    var cd0 = interpTab(TAB.CD0, mach);
    var cd2 = AERO_C.useNonlinear ? interpTab(TAB.CD2, mach) : 0;
    var cna0 = interpTab(TAB.CNa0, mach);
    var cna2 = AERO_C.useNonlinear ? interpTab(TAB.CNa2, mach) : 0;
    var Cd = cd0 + cd2 * sa2;
    var CN = (cna0 + cna2 * sa2) * sinAt;

    var Fx = -qd * S * Cd;
    var Fy = 0, Fz = 0;
    if (sinAt > 1e-9) {
      var invSin = 1 / (V * sinAt);
      Fy = qd * S * CN * (-vb) * invSin;
      Fz = qd * S * CN * (-wb) * invSin;
    }

    // 角速度相关力矩基准：M = (q·S·d²/V)·C·ω（BRL 命名法）
    var base = qd * S * d * d / V;
    var pdV = wx * d / V;

    // Magnus 力（量级小，默认关闭；仅旋转弹表存在时生效）
    if (AERO_C.useMagnusForce && TAB.CNp && alphaT > 1e-9) {
      var cnp = interpTab(TAB.CNp, mach);
      var magF = qd * S * pdV * cnp * sinAt;
      Fy += magF * (beta / alphaT);
      Fz += magF * (alpha / alphaT);
    }

    // ---- 翻转力矩（静力矩；CMa>0 为静不稳定，由自转陀螺稳定）----
    var cma0 = interpTab(TAB.CMa0, mach);
    var cma2 = AERO_C.useNonlinear ? interpTab(TAB.CMa2, mach) : 0;
    var CM = (cma0 + cma2 * sa2) * sinAt;
    var Ms = qd * S * d * CM;
    var My = 0, Mz = 0;
    if (alphaT > 1e-12) {                 // 攻角为零时静力矩为零，避免 0/0
      My = -Ms * (beta / alphaT);
      Mz = Ms * (alpha / alphaT);
    }

    // ---- 俯仰阻尼、滚转阻尼（BRL 归一，含攻角非线性项）----
    var cmq = interpTab(TAB.Cmq0, mach);
    if (AERO_C.useNonlinear && TAB.Cmq2) cmq += interpTab(TAB.Cmq2, mach) * sa2;
    var Mx = 0;
    if (TAB.Clp) Mx = base * interpTab(TAB.Clp, mach) * wx;
    My += base * cmq * wy;
    Mz += base * cmq * wz;

    // ---- Magnus 力矩（旋转弹产生偏流/极限环偏航；尾翼弹表不存在则跳过）----
    if (AERO_C.useMagnusMoment && TAB.CMp && alphaT > 1e-9) {
      var cmp = interpTab(TAB.CMp, mach);
      var Mm = base * wx * cmp * sinAt;
      // 方向垂直于攻角平面：(0, β, -α)（右旋弹 p>0 时产生向右偏流）
      My += Mm * (beta / alphaT);
      Mz -= Mm * (alpha / alphaT);
    }

    // ---- 合力转到地面系 ----
    var invM = 1 / SHELL.mass;
    var fwx = (R00 * Fx + R01 * Fy + R02 * Fz) * invM;
    var fwy = (R10 * Fx + R11 * Fy + R12 * Fz) * invM;
    var fwz = (R20 * Fx + R21 * Fy + R22 * Fz) * invM;

    // 重力随高度衰减
    var g = G0 * R_EARTH * R_EARTH / ((R_EARTH + y[1]) * (R_EARTH + y[1]));
    fwy -= g;

    // 科氏力 a = -2 Ω × v（Ω 在发射系下的分量）
    var corZ = 0;
    if (CUR.useCoriolis) {
      var ox = CUR.omgX, oy = CUR.omgY, oz = CUR.omgZ;
      var acx = -2 * (oy * vz - oz * vy);      // -2(Ω×v)_x
      var acy = -2 * (oz * vx - ox * vz);
      var acz = -2 * (ox * vy - oy * vx);
      fwx += acx; fwy += acy; fwz += acz;
      corZ = acz;
    }

    // 累积"科氏力单独贡献"的侧向位移（诊断用，不进入真实状态耦合）
    var zc = y[13], vc = y[14];

    // ---- 转动动力学（欧拉方程，Ix 为极轴、Iy 为赤道轴）----
    var A = SHELL.Ix, B = SHELL.Iy;
    var dwx = Mx / A;
    var dwy = (My - wx * wz * (A - B)) / B;
    var dwz = (Mz - wx * wy * (B - A)) / B;

    // ---- 状态导数 ----
    out[0] = vx; out[1] = vy; out[2] = vz;
    out[3] = fwx; out[4] = fwy; out[5] = fwz;
    out[6] = -0.5 * (qx * wx + qy * wy + qz * wz);
    out[7] = 0.5 * (qw * wx + qy * wz - qz * wy);
    out[8] = 0.5 * (qw * wy - qx * wz + qz * wx);
    out[9] = 0.5 * (qw * wz + qx * wy - qy * wx);
    out[10] = dwx; out[11] = dwy; out[12] = dwz;
    out[13] = vc;
    out[14] = corZ;
    return out;
  }

  /* ------------------------------- RK4 积分 ------------------------------- */
  var NS = 15;
  var K1 = new Float64Array(NS), K2 = new Float64Array(NS),
      K3 = new Float64Array(NS), K4 = new Float64Array(NS),
      YT = new Float64Array(NS);

  function rk4(y, h) {
    var i;
    deriv(y, K1);
    for (i = 0; i < NS; i++) YT[i] = y[i] + 0.5 * h * K1[i];
    deriv(YT, K2);
    for (i = 0; i < NS; i++) YT[i] = y[i] + 0.5 * h * K2[i];
    deriv(YT, K3);
    for (i = 0; i < NS; i++) YT[i] = y[i] + h * K3[i];
    deriv(YT, K4);
    for (i = 0; i < NS; i++) {
      y[i] += h * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]) / 6;
    }
    // 四元数归一化
    var n = Math.sqrt(y[6] * y[6] + y[7] * y[7] + y[8] * y[8] + y[9] * y[9]);
    if (n > 0) {
      var inv = 1 / n;
      y[6] *= inv; y[7] *= inv; y[8] *= inv; y[9] *= inv;
    }
  }

  /* --------------------------- 姿态/状态派生量 ---------------------------- */
  function quatToMatrix(q) {
    var w = q[0], x = q[1], y = q[2], z = q[3];
    var xx = x * x, yy = y * y, zz = z * z;
    return [
      [1 - 2 * (yy + zz), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (xx + zz), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (xx + yy)]
    ];
  }

  /* 陀螺稳定因子 Sg = (Ix·p)² / (4·Iy·q·S·d·CMα)
   * Sg > 1 时陀螺稳定（McCoy, Modern Exterior Ballistics, Eq. 9.x） */
  function stabilityFactor(spin, qd, mach) {
    var cma = interpTab(TAB.CMa0, mach);
    if (!(cma > 1e-12) || !(qd > 1e-9)) return Infinity;   // 静稳定或静力矩为零
    var K = qd * SHELL.S * SHELL.D * cma;
    var IxP = SHELL.Ix * spin;
    return IxP * IxP / (4 * SHELL.Iy * K);
  }

  function deriveKinematics(y, s) {
    var qw = y[6], qx = y[7], qy = y[8], qz = y[9];
    var vx = y[3], vy = y[4], vz = y[5];
    var xx = qx * qx, yy = qy * qy, zz = qz * qz;
    var R00 = 1 - 2 * (yy + zz), R01 = 2 * (qx * qy - qw * qz), R02 = 2 * (qx * qz + qw * qy);
    var R10 = 2 * (qx * qy + qw * qz), R11 = 1 - 2 * (xx + zz), R12 = 2 * (qy * qz - qw * qx);
    var R20 = 2 * (qx * qz - qw * qy), R21 = 2 * (qy * qz + qw * qx), R22 = 1 - 2 * (xx + yy);

    // 相对空气速度
    var rvx = vx, rvy = vy, rvz = vz;
    if (CUR.useWind && (CUR.windCross !== 0 || CUR.windHead !== 0)) {
      var wf = windProfile(y[1]);
      rvx += CUR.windHead * wf;   // 纵风 + 为逆风（吹向 -x）
      rvz -= CUR.windCross * wf;
    }
    var V2 = rvx * rvx + rvy * rvy + rvz * rvz;
    var V = Math.sqrt(V2) + 1e-9;
    var ub = R00 * rvx + R10 * rvy + R20 * rvz;
    var vb = R01 * rvx + R11 * rvy + R21 * rvz;
    var wb = R02 * rvx + R12 * rvy + R22 * rvz;

    var atm = atmosphere(y[1], CUR.dT, ATMO_KIN);
    var mach = V / atm.a;
    var qd = 0.5 * atm.rho * V2;

    var alpha = 0, beta = 0;
    if (ub > 0.15 * V) {
      alpha = Math.atan2(-vb, ub);
      beta = Math.atan2(-wb, ub);
    }

    // 弹轴方向（世界系）
    var ax = R00, ay = R10, az = R20;

    var speedGround = Math.sqrt(vx * vx + vy * vy + vz * vz);
    s.t = s.t != null ? s.t : 0;
    s.x = y[0]; s.y = y[1]; s.z = y[2];
    s.vx = vx; s.vy = vy; s.vz = vz;
    s.rvx = rvx; s.rvy = rvy; s.rvz = rvz;   // 相对空气速度（攻角基准，供 UI 风轴系使用）
    s.speed = speedGround;
    s.mach = mach;
    s.alpha = alpha * RAD2DEG;
    s.beta = beta * RAD2DEG;
    s.alphaT = Math.sqrt(alpha * alpha + beta * beta) * RAD2DEG;
    s.theta = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)) * RAD2DEG; // 弹道倾角
    s.pitch = Math.asin(Math.max(-1, Math.min(1, ay))) * RAD2DEG;      // 弹轴俯仰
    s.yaw = Math.atan2(-az, ax) * RAD2DEG;
    s.wx = y[10]; s.wy = y[11]; s.wz = y[12];
    s.omega = Math.sqrt(y[10] * y[10] + y[11] * y[11] + y[12] * y[12]);
    s.qdyn = qd / 1000;   // kPa
    s.rho = atm.rho;
    s.T = atm.T;
    s.ax = ax; s.ay = ay; s.az = az;
    s.quat = [y[6], y[7], y[8], y[9]];
    s.coriolisDrift = y[13];
    s.aeroDrift = y[2] - y[13];
    s.sg = stabilityFactor(y[10], qd, mach);
    return s;
  }

  /* ------------------------------ 随机数 ---------------------------------- */
  var RNG = Math.random;

  function makeLCG(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(1103515245, s) + 12345) >>> 0;
      return s / 4294967296;
    };
  }
  function rnd() { return RNG(); }
  function randn() {
    var u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ------------------------- 四元数：欧拉角 → 四元数 ---------------------
   * 弹轴俯仰角 th（绕世界 z 轴），偏航角 ps（绕世界 y 轴，正 = 偏左）
   * R = Rz(th)·Ry(ps)
   * ---------------------------------------------------------------------- */
  function quatFromAngles(th, ps) {
    var ct = Math.cos(th * 0.5), st = Math.sin(th * 0.5);
    var cp = Math.cos(ps * 0.5), sp = Math.sin(ps * 0.5);
    // q = qz(th) * qy(ps)
    return [
      ct * cp,
      -st * sp,
      ct * sp,
      st * cp
    ];
  }

  function spinFromTwist(v0, twist) {
    if (!(twist > 0)) return 0;
    return 2 * Math.PI * v0 / (twist * SHELL.D);
  }

  /* ------------------------------ 主仿真函数 ------------------------------
   * @param {Object} cfg
   *   v0        初速 m/s            (默认取当前弹型预设 defaults.v0)
   *   angle     射角 deg            (默认取当前弹型预设 defaults.angle)
   *   hBoom     空炸高度 m，0=触地  (默认 12)
   *   twist     膛线缠距 口径/转     (默认 SHELL.twist)
   *   spin      直接给定炮口转速 rad/s（覆盖 twist 换算，测试用）
   *   jump      炮口跳角 deg         (默认取预设 defaults.jump)
   *   yaw0      炮口偏航角 deg       (默认取预设 defaults.yaw0)
   *   wy0/wz0   炮口横向角速度 rad/s (默认取预设 defaults.wy0/wz0)
   *   env       环境参数（见 ENV_DEFAULT）
   *   dt        积分步长 s           (默认按自转自适应，≤0.5 ms)
   *   sampleDt  采样间隔 s           (默认 0.01)
   *   maxTime   最大仿真时间 s       (默认 140)
   *   fragCount 破片数              (默认 800)
   *   seed      随机种子（可选，可复现破片抽样）
   * ---------------------------------------------------------------------- */
  function simulate(cfg) {
    cfg = cfg || {};
    if (cfg.preset && PRESETS[cfg.preset] && cfg.preset !== PRESET_NAME) applyPreset(cfg.preset);
    var PD = PRESETS[PRESET_NAME].defaults;
    var v0 = cfg.v0 != null ? cfg.v0 : PD.v0;
    var ang = (cfg.angle != null ? cfg.angle : PD.angle) * DEG2RAD;
    var hBoom = cfg.hBoom != null ? cfg.hBoom : 12;
    var maxT = cfg.maxTime != null ? cfg.maxTime : 140;
    var sampleDt = cfg.sampleDt != null ? cfg.sampleDt : 0.01;

    var env = setEnv(cfg.env);
    var twist = cfg.twist != null ? cfg.twist : SHELL.twist;
    var spin = cfg.spin != null ? cfg.spin : spinFromTwist(v0, twist);
    // 自适应积分步长：自转越快，姿态积分需要越小步长（默认 ≤0.5 ms）
    var dt = cfg.dt != null ? cfg.dt
      : Math.max(0.0001, Math.min(0.0005, 0.34 / Math.max(1, Math.abs(spin))));
    var jump = (cfg.jump != null ? cfg.jump : PD.jump) * DEG2RAD;
    var yaw0 = (cfg.yaw0 != null ? cfg.yaw0 : PD.yaw0) * DEG2RAD;
    var wy0 = cfg.wy0 != null ? cfg.wy0 : PD.wy0;
    var wz0 = cfg.wz0 != null ? cfg.wz0 : PD.wz0;

    var seed = cfg.seed != null ? cfg.seed : 2024;   // 默认固定种子，保证结果可复现
    var oldRng = RNG;
    RNG = makeLCG(seed);
    try {
      var y = new Float64Array(NS);
      y[0] = 0; y[1] = 0; y[2] = 0;
      y[3] = v0 * Math.cos(ang);
      y[4] = v0 * Math.sin(ang);
      y[5] = 0;
      // 弹轴指向：射角 + 跳角，含小偏航
      var q0 = quatFromAngles(ang + jump, yaw0);
      y[6] = q0[0]; y[7] = q0[1]; y[8] = q0[2]; y[9] = q0[3];
      y[10] = spin;
      y[11] = wy0;
      y[12] = wz0;
      y[13] = 0; y[14] = 0;

      var samples = [];
      var state = { t: 0 };
      deriveKinematics(y, state);
      samples.push(state);

      var t = 0;
      var nextSample = sampleDt;
      var boom = null;
      var apex = { t: 0, x: 0, alt: 0 };
      var apexFound = false;
      var prevY = y[1];
      var trigger = hBoom > 0.5 ? hBoom : 0;
      var iter = 0;
      var MAX_ITER = Math.ceil(maxT / dt);
      var fuzeReached = false;

      while (iter++ < MAX_ITER) {
        var oldY = y[1];
        var oldX = y[0], oldZ = y[2];

        rk4(y, dt);
        t += dt;

        // 顶点（第一次 vy 由正变负；记录本步起点状态，更接近 vy=0 时刻）
        if (!apexFound && y[4] < 0 && oldY >= 0) {
          apexFound = true;
          apex = { t: t - dt, x: oldX, alt: oldY, range: Math.sqrt(oldX * oldX + oldZ * oldZ) };
        }

        var descending = y[4] < 0;
        // 若弹道顶点低于设定炸高，引信不会在设定高度起爆 → 按触地处理
        var trig = trigger;
        if (oldY <= trig) trig = 0;
        if (descending && oldY > trig && y[1] <= trig && t > 0.2) {
          // 线性插值到触发面
          var frac = (oldY - trig) / (oldY - y[1] + 1e-12);
          frac = Math.max(0, Math.min(1, frac));

          var tmp = new Float64Array(NS);
          for (var kk = 0; kk < NS; kk++) tmp[kk] = y[kk];
          tmp[0] = oldX + (y[0] - oldX) * frac;
          tmp[1] = trig;
          tmp[2] = oldZ + (y[2] - oldZ) * frac;
          // 速度/姿态/角速度按 frac 线性插值（与旧值相比此处直接取新步值亦可，
          // 但用 k1..k4 的加权更准；frac 很小时差异可忽略）
          var stk = deriveKinematics(tmp, { t: t - dt + dt * frac });

          boom = {
            t: t - dt + dt * frac,
            x: tmp[0], y: trig, z: tmp[2],
            speed: Math.sqrt(tmp[3] * tmp[3] + tmp[4] * tmp[4] + tmp[5] * tmp[5]),
            vx: tmp[3], vy: tmp[4], vz: tmp[5],
            quat: [tmp[6], tmp[7], tmp[8], tmp[9]],
            alpha: stk.alpha,
            beta: stk.beta,
            theta: stk.theta,
            mach: stk.mach,
            spin: tmp[10],
            qdyn: stk.qdyn,
            coriolisDrift: tmp[13],
            impact: trig < 0.5
          };
          fuzeReached = true;
          break;
        }

        if (t >= nextSample) {
          state = { t: t };
          deriveKinematics(y, state);
          samples.push(state);
          nextSample += sampleDt;
        }

        if (!isFinite(y[0]) || y[1] < -2) break;
      }

      // 未正常触发：若设定炸高高于弹道顶点，则按触地处理
      if (!boom) {
        var stLast = { t: t };
        deriveKinematics(y, stLast);
        boom = {
          t: t, x: y[0], y: Math.max(0, y[1]), z: y[2],
          speed: Math.sqrt(y[3] * y[3] + y[4] * y[4] + y[5] * y[5]),
          vx: y[3], vy: y[4], vz: y[5],
          quat: [y[6], y[7], y[8], y[9]],
          alpha: stLast.alpha, beta: stLast.beta, theta: stLast.theta,
          mach: stLast.mach, spin: y[10], qdyn: stLast.qdyn,
          coriolisDrift: y[13],
          impact: true
        };
      }

      // ------------------------------ 统计 ------------------------------
      var maxAlt = 0, maxSpeed = 0, maxMach = 0, maxAlpha = 0, maxBeta = 0,
          maxQ = 0, maxAbsZ = 0, sgMin = Infinity;
      for (var i = 0; i < samples.length; i++) {
        var s = samples[i];
        if (s.y > maxAlt) maxAlt = s.y;
        if (s.speed > maxSpeed) maxSpeed = s.speed;
        if (s.mach > maxMach) maxMach = s.mach;
        if (Math.abs(s.alpha) > maxAlpha) maxAlpha = Math.abs(s.alpha);
        if (Math.abs(s.beta) > maxBeta) maxBeta = Math.abs(s.beta);
        if (s.qdyn > maxQ) maxQ = s.qdyn;
        if (Math.abs(s.z) > maxAbsZ) maxAbsZ = Math.abs(s.z);
        if (s.sg < sgMin) sgMin = s.sg;
      }

      var range = Math.sqrt(boom.x * boom.x + boom.z * boom.z);
      var cnaM = interpTab(TAB.CNa0, samples[0].mach);
      var cmaM = interpTab(TAB.CMa0, samples[0].mach);
      var staticMargin = -cmaM / Math.max(Math.abs(cnaM), 1e-9);  // cal，正 = 静稳定
      var result = {
        cfg: {
          v0: v0, angle: cfg.angle != null ? cfg.angle : PD.angle,
          hBoom: hBoom, twist: twist, spin: spin,
          fragCount: cfg.fragCount != null ? cfg.fragCount : PD.fragCount,
          preset: PRESET_NAME, seed: seed
        },
        preset: PRESET_NAME,
        presetName: SHELL.presetName,
        aeroSource: SHELL.aeroSource,
        spinStabilized: SHELL.spinMode !== 'none',
        staticMargin: staticMargin,
        staticallyStable: cmaM < 0,
        shell: JSON.parse(JSON.stringify(SHELL)),
        env: env,
        samples: samples,
        sampleDt: sampleDt,
        dt: dt,
        boom: boom,
        apex: apex,
        fuzeReached: fuzeReached,
        flightTime: boom.t,
        range: range,
        maxAlt: maxAlt,
        maxSpeed: maxSpeed,
        maxMach: maxMach,
        maxAlpha: maxAlpha,
        maxBeta: maxBeta,
        maxQ: maxQ,
        spin0: spin,
        spinBurst: boom.spin,
        spinLoss: spin > 0 ? (spin - boom.spin) / spin : 0,
        Sg0: samples.length ? samples[0].sg : 0,
        SgMin: isFinite(sgMin) ? sgMin : 0,
        drift: boom.z,
        coriolisDrift: boom.coriolisDrift,
        aeroDrift: boom.z - boom.coriolisDrift,   // 总侧偏扣除科氏累积（气动/初始扰动偏流）
        impactX: boom.x,
        impactY: boom.y,
        impactZ: boom.z,
        impactSpeed: boom.speed,
        impactAngle: boom.theta,
        impactMach: boom.mach
      };

      result.fragments = simulateFragments(result, cfg);
      return result;
    } finally {
      RNG = oldRng;
    }
  }

  /* ------------------------------ 破片仿真 --------------------------------
   * 说明：fragCount 为 Monte-Carlo 统计样本数（默认 800，可调 200–1600），
   * 由 Mott 分布描述总体质量分布，质量按壳体金属质量守恒归一；
   * 它不是特定型号的全部物理破片数。
   * 1) 质量分布 —— Mott 分布：N(>m) = N0·exp(-√(m/μ))，平均质量 = 2μ
   *    逆 CDF 采样：m = μ·[ln(1/(1-u))]²
   * 2) 初速 —— Gurney 公式：v_G = √(2E·β/(1+β/2))，β = C/M
   *    端部折减 + 分区速度因子 + 小破片略高
   * 3) 动爆 —— 弹丸速度矢量叠加 + 自转切向速度 ω×r
   * 4) 飞散角 —— 截短正态，弹头/圆柱/弹底三区
   * 5) 存速 —— 变密度大气 + 马赫相关 Cd + 风场相对速度
   * ---------------------------------------------------------------------- */
  var FRAG_ZONES = [
    // φ 均值(°) φ 标准差  质量因子  初速因子  质量权重
    { phi: 42, sig: 13, mf: 0.72, vf: 1.04, w: 0.16 },  // 弹头：前向锥，碎块小
    { phi: 90, sig: 17, mf: 1.00, vf: 1.00, w: 0.74 },  // 圆柱：赤道带
    { phi: 139, sig: 15, mf: 1.55, vf: 0.94, w: 0.10 }  // 弹底：后向锥，大块
  ];

  /* 不规则破片阻力系数（随马赫数；钝体不规则形状量级 1.0–1.5） */
  function fragCd(mach) {
    if (mach < 0.6) return 1.02;
    if (mach < 1.05) return 1.02 + 0.40 * (mach - 0.6) / 0.45;
    if (mach < 2.0) return 1.42 - 0.14 * (mach - 1.05);
    return 1.29;
  }

  /* Mott 分布逆采样 */
  function sampleMottMass(mu) {
    var u = rnd();
    if (u > 0.9994) u = 0.9994;
    var l = Math.log(1 / (1 - u));
    return mu * l * l;
  }

  /* 破片气动加速度（世界系）：阻力 + 重力 + 风场相对速度 */
  var FRAG_A = new Float64Array(3);
  function fragAccel(px, py, vx, vy, vz, mass, Aref, out) {
    var wfx = 0, wfz = 0;
    if (CUR.useWind && (CUR.windCross !== 0 || CUR.windHead !== 0)) {
      var wf = windProfile(py);
      wfx = -CUR.windHead * wf;
      wfz = CUR.windCross * wf;
    }
    var rvx = vx - wfx, rvy = vy, rvz = vz - wfz;
    var sp = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz) + 1e-9;
    var atm = atmosphere(py, CUR.dT, ATMO_FRAG);
    var kd = 0.5 * atm.rho * fragCd(sp / atm.a) * Aref / mass;
    out[0] = -kd * sp * rvx;
    out[1] = -kd * sp * rvy - G0;
    out[2] = -kd * sp * rvz;
    return out;
  }

  function simulateFragments(sim, cfg) {
    var N = Math.max(50, Math.min(2400, (cfg && cfg.fragCount) || 800));
    var boom = sim.boom;
    var R = quatToMatrix(boom.quat);

    // Gurney 初速
    var betaG = SHELL.charge / SHELL.casing;
    var vG = Math.sqrt(SHELL.gurney2E * betaG / (1 + betaG / 2)); // ≈1254 m/s

    // Mott 特征质量：μ = 平均质量 / 2
    var meanM = SHELL.casing / N;
    var mu = meanM / 2;

    var dt = (cfg && cfg.fragDt) ? cfg.fragDt : 0.005;  // 破片弹道 RK4 步长
    var sampleDt = 0.02;
    var maxFlight = 60;
    var pSpin = boom.spin || 0;

    var i, k, s;

    /* ---- 1) 质量抽样（Mott 逆 CDF）+ 端部分区 ---- */
    var masses = new Array(N);
    var zones = new Array(N);
    var axialU = new Array(N);
    var sumM = 0;

    for (i = 0; i < N; i++) {
      var zr = rnd(), zi = 0, acc = 0;
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
      if (zi === 0) axialU[i] = 0.55 + 0.45 * rnd();
      else if (zi === 2) axialU[i] = -0.55 - 0.45 * rnd();
      else axialU[i] = (rnd() * 2 - 1) * 0.55;
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
      var phi = (zone2.phi + randn() * zone2.sig) * DEG2RAD;
      if (phi < 8 * DEG2RAD) phi = 8 * DEG2RAD;
      if (phi > 172 * DEG2RAD) phi = 172 * DEG2RAD;
      var gamma = rnd() * Math.PI * 2;

      // Gurney 端部折减：越靠近端部初速越低
      var u = axialU[i];
      var axial = Math.sqrt(Math.max(0.55, 1 - 0.22 * u * u));

      // 小破片初速略高（当地装填比更高）
      var vRel = vG * axial * zone2.vf * Math.pow(meanM / mass, 0.13) * (1 + 0.05 * randn());
      if (vRel < 150) vRel = 150;

      // 弹体系下的飞散方向
      var sinP = Math.sin(phi), cosP = Math.cos(phi);
      var dl0 = cosP, dl1 = sinP * Math.cos(gamma), dl2 = sinP * Math.sin(gamma);

      // 破片起始位置：壳体表面（轴向位置 + 半径）
      var uAx = u * SHELL.L / 2;
      var py0 = SHELL.wallR * dl1;
      var pz0 = SHELL.wallR * dl2;
      var bx0 = uAx; // 简化为轴线位置，径向偏置在 y/z

      // 自转切向速度 v = ω × r（ω ≈ p·x1）
      var vtx = 0;
      var vty = -pSpin * pz0;
      var vtz = pSpin * py0;

      // 弹体系速度 = 径向飞散 + 切向自转速度
      var vbx = dl0 * vRel + vtx;
      var vby = dl1 * vRel + vty;
      var vbz = dl2 * vRel + vtz;

      // 弹体系 → 世界系
      var dxw = R[0][0] * vbx + R[0][1] * vby + R[0][2] * vbz;
      var dyw = R[1][0] * vbx + R[1][1] * vby + R[1][2] * vbz;
      var dzw = R[2][0] * vbx + R[2][1] * vby + R[2][2] * vbz;

      // 动爆：弹丸速度矢量叠加
      var vx = boom.vx + dxw;
      var vy = boom.vy + dyw;
      var vz = boom.vz + dzw;

      var px = boom.x + R[0][1] * py0 + R[0][2] * pz0 + R[0][0] * bx0;
      var py = boom.y + R[1][1] * py0 + R[1][2] * pz0 + R[1][0] * bx0;
      var pz = boom.z + R[2][1] * py0 + R[2][2] * pz0 + R[2][0] * bx0;

      var v0f = Math.sqrt(dxw * dxw + dyw * dyw + dzw * dzw);

      // 迎风面积 ~ m^(2/3)，不规则形状因子 1.45
      var Aref = Math.pow(mass / SHELL.fragDensity, 2 / 3) * 1.45;

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
        var vxPrev = vx, vyPrev = vy, vzPrev = vz;

        // 变密度大气 + 马赫相关 Cd + 风场，RK4（位置/速度）
        var a1 = fragAccel(px, py, vx, vy, vz, mass, Aref, FRAG_A);
        var a1x = a1[0], a1y = a1[1], a1z = a1[2];
        var v2x = vx + 0.5 * dt * a1x, v2y = vy + 0.5 * dt * a1y, v2z = vz + 0.5 * dt * a1z;
        var a2 = fragAccel(px + 0.5 * dt * vx, py + 0.5 * dt * vy, v2x, v2y, v2z, mass, Aref, FRAG_A);
        var a2x = a2[0], a2y = a2[1], a2z = a2[2];
        var v3x = vx + 0.5 * dt * a2x, v3y = vy + 0.5 * dt * a2y, v3z = vz + 0.5 * dt * a2z;
        var a3 = fragAccel(px + 0.5 * dt * v2x, py + 0.5 * dt * v2y, v3x, v3y, v3z, mass, Aref, FRAG_A);
        var a3x = a3[0], a3y = a3[1], a3z = a3[2];
        var v4x = vx + dt * a3x, v4y = vy + dt * a3y, v4z = vz + dt * a3z;
        var a4 = fragAccel(px + dt * v3x, py + dt * v3y, v4x, v4y, v4z, mass, Aref, FRAG_A);
        var a4x = a4[0], a4y = a4[1], a4z = a4[2];

        px += dt / 6 * (vx + 2 * v2x + 2 * v3x + v4x);
        py += dt / 6 * (vy + 2 * v2y + 2 * v3y + v4y);
        pz += dt / 6 * (vz + 2 * v2z + 2 * v3z + v4z);
        vx += dt / 6 * (a1x + 2 * a2x + 2 * a3x + a4x);
        vy += dt / 6 * (a1y + 2 * a2y + 2 * a3y + a4y);
        vz += dt / 6 * (a1z + 2 * a2z + 2 * a3z + a4z);
        tt += dt;

        if (py <= 0 && pyPrev > 0) {
          var ff = pyPrev / (pyPrev - py + 1e-12);
          ff = ff < 0 ? 0 : (ff > 1 ? 1 : ff);
          landX = pxPrev + (px - pxPrev) * ff;
          landZ = pzPrev + (pz - pzPrev) * ff;
          var lvx = vxPrev + (vx - vxPrev) * ff;
          var lvy = vyPrev + (vy - vyPrev) * ff;
          var lvz = vzPrev + (vz - vzPrev) * ff;
          landV = Math.sqrt(lvx * lvx + lvy * lvy + lvz * lvz);
          landT = boom.t + tt - dt * (1 - ff);
          landed = true;
          px = landX; py = 0; pz = landZ;
          break;
        }
      }

      if (!landed) {
        landX = px; landZ = pz;
        landV = Math.sqrt(vx * vx + vy * vy + vz * vz);
        landT = boom.t + tt;
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
        v0: v0f,
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
    var maxFragM = 0, meanFragM = 0, massSum = 0;
    for (i = 0; i < N; i++) {
      meanFragM += frags[i].m;
      massSum += frags[i].m;
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
      effectiveCount: effectiveCount,
      mu: mu,
      meanMass: meanFragM,
      maxMass: maxFragM,
      massSum: massSum,
      zoneCount: zoneCount,
      forwardMax: forwardMax > -1e8 ? forwardMax : 0,
      backMin: backMin < 1e8 ? backMin : 0,
      lateralMax: lateralMax,
      duration: maxLandT,
      unlanded: N - landedCount,
      spin: pSpin
    };
  }

  /* ------------------------------ 导出接口 -------------------------------- */
  var Ballistics = {
    SHELL: SHELL,
    ENV_DEFAULT: ENV_DEFAULT,
    TAB: function () { return TAB; },
    AERO_C: AERO_C,
    PRESETS: PRESETS,
    applyPreset: applyPreset,
    getPreset: function () { return PRESET_NAME; },
    INTERP: interpTab,
    simulate: simulate,
    atmosphere: atmosphere,
    aeroAt: aeroAt,
    deriveKinematics: deriveKinematics,
    quatToMatrix: quatToMatrix,
    spinFromTwist: spinFromTwist,
    stabilityFactor: stabilityFactor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Ballistics;
  root.Ballistics = Ballistics;

})(typeof window !== 'undefined' ? window : globalThis);
