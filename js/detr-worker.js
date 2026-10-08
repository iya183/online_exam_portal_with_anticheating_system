let detectorPromise;

async function loadDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { pipeline, env } = await import(
        'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js'
      );
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.backends.onnx.wasm.numThreads = 1;
      return pipeline('object-detection', 'Xenova/detr-resnet-50', { dtype: 'q8' });
    })();
  }
  return detectorPromise;
}

loadDetector()
  .then(() => self.postMessage({ type: 'ready' }))
  .catch((error) => self.postMessage({ type: 'error', error: error.message }));

self.addEventListener('message', async ({ data }) => {
  if (data.type !== 'detect') return;

  let imageUrl;
  try {
    const detector = await loadDetector();
    imageUrl = URL.createObjectURL(data.image);
    const predictions = await detector(imageUrl, { threshold: 0.3 });
    const detections = predictions.map((prediction) => {
      const { xmin, ymin, xmax, ymax } = prediction.box;
      return {
        label: prediction.label.toLowerCase(),
        confidence: prediction.score,
        bbox: [ymin / data.height, xmin / data.width, ymax / data.height, xmax / data.width],
      };
    });
    self.postMessage({ type: 'result', id: data.id, detections });
  } catch (error) {
    self.postMessage({ type: 'result', id: data.id, error: error.message });
  } finally {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }
});