/**
 * Minimal type declarations for p5.js
 */
declare module "p5" {
  interface p5 {
    // Lifecycle
    preload?: () => void;
    setup?: () => void;
    draw?: () => void;
    remove(): void;

    // Canvas
    createCanvas(w: number, h: number, renderer?: string): object;
    resizeCanvas(w: number, h: number, noRedraw?: boolean): void;
    background(v1: number, v2?: number, v3?: number, v4?: number): this;
    clear(): this;

    // Rendering
    loop(): void;
    noLoop(): void;
    push(): void;
    pop(): void;
    redraw(n?: number): void;

    // Color
    fill(v1: number, v2?: number, v3?: number, v4?: number): this;
    noFill(): this;
    stroke(v1: number, v2?: number, v3?: number, v4?: number): this;
    noStroke(): this;
    strokeWeight(weight: number): this;
    colorMode(
      mode: string,
      max1?: number,
      max2?: number,
      max3?: number,
      max4?: number,
    ): this;

    // Shapes
    ellipse(x: number, y: number, w: number, h?: number): this;
    circle(x: number, y: number, d: number): this;
    rect(
      x: number,
      y: number,
      w: number,
      h?: number,
      tl?: number,
      tr?: number,
      br?: number,
      bl?: number,
    ): this;
    line(x1: number, y1: number, x2: number, y2: number): this;
    point(x: number, y: number): this;
    triangle(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x3: number,
      y3: number,
    ): this;
    arc(
      x: number,
      y: number,
      w: number,
      h: number,
      start: number,
      stop: number,
      mode?: string,
      detail?: number,
    ): this;
    quad(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x3: number,
      y3: number,
      x4: number,
      y4: number,
    ): this;
    bezier(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x3: number,
      y3: number,
      x4: number,
      y4: number,
    ): this;

    // 3D Shapes
    box(w?: number, h?: number, d?: number): this;
    sphere(r?: number, detailX?: number, detailY?: number): this;
    cylinder(
      r?: number,
      h?: number,
      detailX?: number,
      detailY?: number,
      bottomCap?: boolean,
      topCap?: boolean,
    ): this;
    cone(
      r?: number,
      h?: number,
      detailX?: number,
      detailY?: number,
      cap?: boolean,
    ): this;
    torus(r?: number, tr?: number, detailX?: number, detailY?: number): this;

    // Transform
    translate(x: number, y: number, z?: number): this;
    rotate(angle: number, axis?: object): this;
    rotateX(angle: number): this;
    rotateY(angle: number): this;
    rotateZ(angle: number): this;
    scale(s: number, y?: number, z?: number): this;

    // Text
    text(
      str: string | number,
      x: number,
      y: number,
      x2?: number,
      y2?: number,
    ): this;
    textSize(size: number): this;
    textFont(font: string | object, size?: number): this;
    textAlign(horizAlign: string, vertAlign?: string): this;

    // Math
    sin(angle: number): number;
    cos(angle: number): number;
    tan(angle: number): number;
    map(
      value: number,
      start1: number,
      stop1: number,
      start2: number,
      stop2: number,
      withinBounds?: boolean,
    ): number;
    lerp(start: number, stop: number, amt: number): number;
    constrain(n: number, low: number, high: number): number;
    random(min?: number, max?: number): number;
    noise(x: number, y?: number, z?: number): number;
    abs(n: number): number;
    sqrt(n: number): number;
    pow(n: number, e: number): number;

    // Constants
    readonly CENTER: string;
    readonly LEFT: string;
    readonly RIGHT: string;
    readonly TOP: string;
    readonly BOTTOM: string;
    readonly BASELINE: string;
    readonly WEBGL: string;
    readonly P2D: string;
    readonly RGB: string;
    readonly HSB: string;
    readonly HSL: string;
    readonly CLOSE: string;
    readonly PI: number;
    readonly TWO_PI: number;
    readonly HALF_PI: number;
    readonly QUARTER_PI: number;

    // Input properties (readonly)
    readonly mouseX: number;
    readonly mouseY: number;
    readonly pmouseX: number;
    readonly pmouseY: number;
    readonly winMouseX: number;
    readonly winMouseY: number;
    readonly pwinMouseX: number;
    readonly pwinMouseY: number;
    readonly mouseButton: string;
    readonly mouseIsPressed: boolean;
    readonly movedX: number;
    readonly movedY: number;
    readonly key: string;
    readonly keyCode: number;
    readonly keyIsPressed: boolean;
    readonly touches: object[];

    // Environment
    readonly frameCount: number;
    readonly deltaTime: number;
    readonly focused: boolean;
    readonly displayWidth: number;
    readonly displayHeight: number;
    readonly windowWidth: number;
    readonly windowHeight: number;
    readonly width: number;
    readonly height: number;
    readonly pixels: number[];

    // Event handlers (optional user-defined)
    mousePressed?: () => void;
    mouseReleased?: () => void;
    mouseClicked?: () => void;
    mouseMoved?: () => void;
    mouseDragged?: () => void;
    mouseWheel?: (event: object) => void;
    keyPressed?: () => void;
    keyReleased?: () => void;
    keyTyped?: () => void;
    touchStarted?: () => void;
    touchMoved?: () => void;
    touchEnded?: () => void;
    windowResized?: () => void;
  }

  interface p5Constructor {
    new (sketch: (p: p5) => void, node?: HTMLElement): p5;
    readonly Vector: object;
  }

  const p5: p5Constructor;
  export = p5;
}
