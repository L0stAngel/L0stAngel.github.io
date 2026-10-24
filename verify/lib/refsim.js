/* verify/lib/refsim.js
 * 独立参考积分器：复用 physics.js 的真实导数函数（deriv），但由审计脚本自己控制
 * 步长 / 初始条件 / 事件检测，用于：
 *   1) RK4 步长收敛性实验（physics.js 的 simulate() 里 dt 写死 1ms，不能改文件）
 *   2) 任意初始扰动（wy/wz/spin）敏感性实验
 *   3) 与 simulate() 输出互相校验（同 dt 时应几乎逐位一致）
 * 步骤顺序特意与 physics.js 中 simulate() 的循环一致，便于逐位对照。
 */
'use strict';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function createRefSim(internals) {
  const deriv = internals.deriv;
  const deriveKinematics = internals.deriveKinematics;

  // 与 physics.js 的 rk4 完全相同的运算顺序；额外记录归一化前的四元数模长
  const K1 = new Float64Array(13), K2 = new Float64Array(13),
        K3 = new Float64Array(13), K4 = new Float64Array(13),
        YT = new Float64Array(13);

  function rk4(y, h, diag) {
    let i;
    deriv(y, K1);
    for (i = 0; i < 13; i++) YT[i] = y[i] + 0.5 * h * K1[i];
    deriv(YT, K2);
    for (i = 0; i < 13; i++) YT[i] = y[i] + 0.5 * h * K2[i];
    deriv(YT, K3);
    for (i = 0; i < 13; i++) YT[i] = y[i] + h * K3[i];
    deriv(YT, K4);
    for (i = 0; i < 13; i++) y[i] += h * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]) / 6;
    if (diag) {
      const n2 = y[6] * y[6] + y[7] * y[7] + y[8] * y[8] + y[9] * y[9];
      const err = Math.abs(Math.sqrt(n2) - 1);
      if (err > diag.maxNormErr) diag.maxNormErr = err;
    }
    const n = Math.sqrt(y[6] * y[6] + y[7] * y[7] + y[8] * y[8] + y[9] * y[9]);
    if (n > 0) {
      const inv = 1 / n;
      y[6] *= inv; y[7] *= inv; y[8] *= inv; y[9] *= inv;
    }
  }

  /**
   * @param {object} cfg 与 Ballistics.simulate 同名参数 + 扩展：
   *   dt       积分步长 s（默认 0.001）
   *   wy,wz    初始弹体系角速度（默认 0 / 1.25，与 physics.js 一致）
   *   sampleDt 采样间隔（默认 0.02）
   *   maxTime  最大仿真时间（默认 140）
   *   diag     可选诊断对象（记录四元数归一化前误差）
   */
  function simulateRef(cfg) {
    cfg = cfg || {};
    const v0 = cfg.v0 != null ? cfg.v0 : 450;
    const ang = (cfg.angle != null ? cfg.angle : 45) * D2R;
    const hBoom = cfg.hBoom != null ? cfg.hBoom : 12;
    const spin = cfg.spin != null ? cfg.spin : 18;
    const maxT = cfg.maxTime != null ? cfg.maxTime : 140;
    const dt = cfg.dt != null ? cfg.dt : 0.001;
    const sampleDt = cfg.sampleDt != null ? cfg.sampleDt : 0.02;

    const y = new Float64Array(13);
    y[0] = 0; y[1] = 0; y[2] = 0;
    y[3] = v0 * Math.cos(ang);
    y[4] = v0 * Math.sin(ang);
    y[5] = 0;
    y[6] = Math.cos(ang / 2);
    y[7] = 0;
    y[8] = 0;
    y[9] = Math.sin(ang / 2);
    y[10] = spin;
    y[11] = cfg.wy != null ? cfg.wy : 0;
    y[12] = cfg.wz != null ? cfg.wz : 1.25;

    const samples = [];
    samples.push(deriveKinematics(y, { t: 0 }));
    let nextSample = 0, t = 0;
    let boom = null;
    const MAX_ITER = Math.floor(maxT / dt);
    let iter = 0;
    const diag = cfg.diag;

    while (iter++ < MAX_ITER) {
      const oldY = y[1], oldX = y[0], oldZ = y[2];
      rk4(y, dt, diag);
      t += dt;

      const trigger = (hBoom > 0.5) ? hBoom : 0;
      if (y[4] < 0 && oldY > trigger && y[1] <= trigger && t > 0.2) {
        let frac = (oldY - trigger) / (oldY - y[1] + 1e-12);
        frac = Math.max(0, Math.min(1, frac));
        const st = {
          t: t - dt + dt * frac,
          pos: [oldX + (y[0] - oldX) * frac, trigger, oldZ + (y[2] - oldZ) * frac],
          vel: [y[3], y[4], y[5]],
          quat: [y[6], y[7], y[8], y[9]],
          speed: Math.sqrt(y[3] * y[3] + y[4] * y[4] + y[5] * y[5])
        };
        const tmp = new Float64Array(13);
        for (let kk = 0; kk < 13; kk++) tmp[kk] = y[kk];
        tmp[0] = st.pos[0]; tmp[1] = st.pos[1]; tmp[2] = st.pos[2];
        const stk = deriveKinematics(tmp, { t: st.t });
        boom = {
          t: st.t, x: st.pos[0], y: st.pos[1], z: st.pos[2],
          speed: st.speed, vx: st.vel[0], vy: st.vel[1], vz: st.vel[2],
          quat: st.quat, alpha: stk.alpha, theta: stk.theta, impact: trigger < 0.5
        };
        break;
      }

      if (t >= nextSample) {
        samples.push(deriveKinematics(y, { t }));
        nextSample += sampleDt;
      }
      if (!isFinite(y[0]) || !isFinite(y[4]) || !isFinite(y[6]) || y[1] < -2) break;
    }

    if (!boom) {
      boom = {
        t, x: y[0], y: Math.max(0, y[1]), z: y[2],
        speed: Math.sqrt(y[3] * y[3] + y[4] * y[4] + y[5] * y[5]),
        vx: y[3], vy: y[4], vz: y[5], quat: [y[6], y[7], y[8], y[9]],
        alpha: 0, theta: 0, impact: true
      };
    }

    let maxAlt = 0, maxSpeed = 0, maxMach = 0, maxAlpha = 0, maxQ = 0, mzMax = 0;
    for (const s of samples) {
      if (s.y > maxAlt) maxAlt = s.y;
      if (s.speed > maxSpeed) maxSpeed = s.speed;
      if (s.mach > maxMach) maxMach = s.mach;
      if (Math.abs(s.alpha) > maxAlpha) maxAlpha = Math.abs(s.alpha);
      if (s.qdyn > maxQ) maxQ = s.qdyn;
      if (Math.abs(s.z) > mzMax) mzMax = Math.abs(s.z);
    }

    return {
      samples, boom,
      flightTime: boom.t,
      range: Math.sqrt(boom.x * boom.x + boom.z * boom.z),
      maxAlt, maxSpeed, maxMach, maxAlpha, maxQ, drift: mzMax,
      impactX: boom.x, impactY: boom.y, impactZ: boom.z,
      dt
    };
  }

  return { rk4, simulateRef };
}

module.exports = { createRefSim, D2R, R2D };
