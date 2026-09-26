import { clamp } from './sim/math.js';
import { rampSteer } from './sim/controls.js';

/**
 * Keyboard, gamepad and touch input merged into one analog control state.
 * Digital steering is rate-limited so taps give small, precise corrections.
 */
export class Input {
  constructor(touchRoot) {
    this.keys = new Set();
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.pressed = new Set(); // edge-triggered actions for this frame
    this.touch = { steer: 0, throttle: 0, brake: 0, active: false };
    this.lastPad = {};
    this.usingPad = false;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    if (touchRoot) this.bindTouch(touchRoot);
  }

  bindTouch(root) {
    const wheel = root.querySelector('[data-touch=steer]');
    const gas = root.querySelector('[data-touch=gas]');
    const brake = root.querySelector('[data-touch=brake]');
    let steerId = null, startX = 0;
    const width = () => Math.max(80, wheel.clientWidth * 0.4);
    wheel.addEventListener('pointerdown', (e) => {
      steerId = e.pointerId; startX = e.clientX;
      wheel.setPointerCapture(e.pointerId);
      this.touch.active = true;
    });
    wheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== steerId) return;
      this.touch.steer = clamp((e.clientX - startX) / width(), -1, 1);
      wheel.style.setProperty('--knob', `${this.touch.steer * 40}%`);
    });
    const endSteer = (e) => {
      if (e.pointerId !== steerId) return;
      steerId = null; this.touch.steer = 0;
      wheel.style.setProperty('--knob', '0%');
    };
    wheel.addEventListener('pointerup', endSteer);
    wheel.addEventListener('pointercancel', endSteer);
    const hold = (el, key) => {
      el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); this.touch[key] = 1; this.touch.active = true; el.classList.add('on'); });
      const up = () => { this.touch[key] = 0; el.classList.remove('on'); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    hold(gas, 'throttle');
    hold(brake, 'brake');
  }

  /** Edge-triggered actions: 'camera', 'reset', 'pause', 'mute', 'lookback'. */
  consume(action) {
    const map = {
      camera: ['KeyC'],
      reset: ['KeyR'],
      pause: ['Escape', 'KeyP'],
      mute: ['KeyM'],
    };
    for (const code of map[action] || []) {
      if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    }
    if (this.pressed.has(`pad:${action}`)) { this.pressed.delete(`pad:${action}`); return true; }
    return false;
  }

  endFrame() { this.pressed.clear(); }

  update(dt, speed = 0) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    const up = k.has('ArrowUp') || k.has('KeyW');
    const down = k.has('ArrowDown') || k.has('KeyS') || k.has('Space');

    // Gamepad (standard mapping).
    let padSteer = 0, padGas = 0, padBrake = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      const dz = 0.08;
      const a = Math.abs(ax) < dz ? 0 : (Math.abs(ax) - dz) / (1 - dz);
      // Slightly progressive curve: fine control around centre.
      padSteer = Math.sign(ax) * (0.4 * a + 0.6 * a * a);
      padGas = Math.max(p.buttons[7]?.value || 0, p.buttons[0]?.pressed ? 1 : 0);
      padBrake = Math.max(p.buttons[6]?.value || 0, p.buttons[2]?.pressed ? 1 : 0);
      const edge = (i, name) => {
        const now = !!p.buttons[i]?.pressed;
        if (now && !this.lastPad[i]) this.pressed.add(`pad:${name}`);
        this.lastPad[i] = now;
      };
      edge(3, 'camera');
      edge(8, 'reset');
      edge(9, 'pause');
      if (Math.abs(padSteer) > 0.05 || padGas > 0.05 || padBrake > 0.05) this.usingPad = true;
      break;
    }

    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (this.usingPad) {
      this.steer = padSteer;
    } else if (this.touch.active && this.touch.steer !== 0) {
      this.steer = this.touch.steer;
    } else {
      this.steer = rampSteer(this.steer, target, dt, speed);
    }
    this.throttle = Math.max(up ? 1 : 0, padGas, this.touch.throttle);
    this.brake = Math.max(down ? 1 : 0, padBrake, this.touch.brake);
    return { steer: this.steer, throttle: this.throttle, brake: this.brake };
  }
}
