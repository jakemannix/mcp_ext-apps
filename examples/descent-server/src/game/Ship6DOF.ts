/**
 * Ship 6DOF Controller
 *
 * Provides Descent-style 6 degrees of freedom flight controls:
 * - Pitch, Yaw, Roll (rotation)
 * - Forward/Back, Strafe Left/Right, Up/Down (translation)
 */
import * as THREE from "three";

// Movement speeds
const MOVE_SPEED = 30; // Units per second
const LOOK_SPEED = 0.002; // Mouse sensitivity
const ROLL_SPEED = 2; // Radians per second
const ACCELERATION = 50; // Units per second squared
const DAMPING = 5; // Velocity damping factor

// Key codes
const KEYS = {
  W: "KeyW",
  A: "KeyA",
  S: "KeyS",
  D: "KeyD",
  Q: "KeyQ",
  E: "KeyE",
  SPACE: "Space",
  SHIFT: "ShiftLeft",
};

export class Ship6DOF {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  // Input state
  private keys: Set<string> = new Set();
  private mouseMovement = { x: 0, y: 0 };
  private isPointerLocked = false;

  // Physics state
  private velocity = new THREE.Vector3();

  // Temporary vectors for calculations
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();

  // Timing
  private lastTime = performance.now();

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Keyboard
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);

    // Mouse
    this.domElement.addEventListener("click", this.onCanvasClick);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onCanvasClick = (): void => {
    if (!this.isPointerLocked) {
      this.domElement.requestPointerLock();
    }
  };

  private onPointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.domElement;
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.isPointerLocked) return;

    this.mouseMovement.x += event.movementX;
    this.mouseMovement.y += event.movementY;
  };

  update(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1); // Cap at 100ms
    this.lastTime = now;

    // Get camera orientation vectors
    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.camera.up).normalize();
    this.up.crossVectors(this.right, this.forward).normalize();

    // Process mouse look (pitch and yaw)
    if (this.isPointerLocked) {
      // Yaw (rotate around world up, or camera's local up for true 6DOF)
      const yawQuaternion = new THREE.Quaternion();
      yawQuaternion.setFromAxisAngle(
        this.up,
        -this.mouseMovement.x * LOOK_SPEED,
      );
      this.camera.quaternion.premultiply(yawQuaternion);

      // Pitch (rotate around camera's local right axis)
      const pitchQuaternion = new THREE.Quaternion();
      pitchQuaternion.setFromAxisAngle(
        this.right,
        -this.mouseMovement.y * LOOK_SPEED,
      );
      this.camera.quaternion.premultiply(pitchQuaternion);

      this.mouseMovement.x = 0;
      this.mouseMovement.y = 0;
    }

    // Process roll (Q/E)
    if (this.keys.has(KEYS.Q)) {
      const rollQuaternion = new THREE.Quaternion();
      rollQuaternion.setFromAxisAngle(this.forward, ROLL_SPEED * dt);
      this.camera.quaternion.premultiply(rollQuaternion);
    }
    if (this.keys.has(KEYS.E)) {
      const rollQuaternion = new THREE.Quaternion();
      rollQuaternion.setFromAxisAngle(this.forward, -ROLL_SPEED * dt);
      this.camera.quaternion.premultiply(rollQuaternion);
    }

    // Normalize quaternion to prevent drift
    this.camera.quaternion.normalize();

    // Calculate target velocity based on input
    const targetVelocity = new THREE.Vector3();

    // Forward/Back (W/S)
    if (this.keys.has(KEYS.W)) {
      targetVelocity.add(this.forward.clone().multiplyScalar(MOVE_SPEED));
    }
    if (this.keys.has(KEYS.S)) {
      targetVelocity.add(this.forward.clone().multiplyScalar(-MOVE_SPEED));
    }

    // Strafe Left/Right (A/D)
    if (this.keys.has(KEYS.A)) {
      targetVelocity.add(this.right.clone().multiplyScalar(-MOVE_SPEED));
    }
    if (this.keys.has(KEYS.D)) {
      targetVelocity.add(this.right.clone().multiplyScalar(MOVE_SPEED));
    }

    // Up/Down (Space/Shift)
    if (this.keys.has(KEYS.SPACE)) {
      targetVelocity.add(this.up.clone().multiplyScalar(MOVE_SPEED));
    }
    if (this.keys.has(KEYS.SHIFT)) {
      targetVelocity.add(this.up.clone().multiplyScalar(-MOVE_SPEED));
    }

    // Smoothly interpolate velocity toward target
    if (targetVelocity.lengthSq() > 0) {
      // Accelerate toward target
      const accel = targetVelocity.clone().sub(this.velocity);
      accel.clampLength(0, ACCELERATION * dt);
      this.velocity.add(accel);
    } else {
      // Dampen velocity when no input
      this.velocity.multiplyScalar(Math.max(0, 1 - DAMPING * dt));
    }

    // Apply velocity to position
    this.camera.position.addScaledVector(this.velocity, dt);
  }

  getVelocity(): THREE.Vector3 {
    return this.velocity.clone();
  }

  getPosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }

  getRotation(): THREE.Euler {
    return this.camera.rotation.clone();
  }

  setPosition(position: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.velocity.set(0, 0, 0);
  }

  dispose(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.domElement.removeEventListener("click", this.onCanvasClick);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);

    if (this.isPointerLocked) {
      document.exitPointerLock();
    }
  }
}
