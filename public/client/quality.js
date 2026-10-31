const B = window.BABYLON;

export class VisualQuality {
  constructor(engine, scene, player, button) {
    Object.assign(this, { engine, scene, button });
    this.high = true;
    this.pipeline = new B.DefaultRenderingPipeline('desktop-quality', false, scene, [player.camera, player.overviewCamera]);
    this.pipeline.imageProcessingEnabled = false;
    this.pipeline.sharpenEnabled = true;
    this.pipeline.sharpen.edgeAmount = .16;
    this.pipeline.sharpen.colorAmount = 1;
    button.onclick = () => { this.high = !this.high; this.apply(); };
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  apply() {
    // Render at actual display density, with a pixel budget for large monitors.
    const pixels = Math.max(1, innerWidth * innerHeight);
    const density = this.high ? Math.min(Math.max(devicePixelRatio, 1.25), 2, Math.sqrt(6000000 / pixels)) : Math.min(devicePixelRatio, 1);
    this.engine.setHardwareScalingLevel(1 / Math.max(.5, density));
    this.pipeline.samples = this.high ? Math.min(4, this.engine.getCaps().maxMSAASamples || 1) : 1;
    this.pipeline.fxaaEnabled = this.pipeline.samples < 2;
    this.pipeline.sharpenEnabled = this.high;
    this.button.textContent = this.high ? 'Графика · высокая' : 'Графика · лёгкая';
    this.button.setAttribute('aria-pressed', String(this.high));
    this.engine.resize();
  }
}
