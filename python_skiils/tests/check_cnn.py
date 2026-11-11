"""실제 TensorFlow CNN 특징 추출·학습·저장·복원 검사. 인터넷 다운로드가 필요할 수 있습니다."""

import os

os.environ.setdefault("KERAS_HOME", "/tmp/phyvibe-python-keras-cache")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
import math
from pathlib import Path
import sys
import tempfile
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cnn

state = cnn.new_classifier(["red", "blue"])
for label, color in [("red", (10, 20, 220)), ("blue", (220, 20, 10))]:
    for number in range(5):
        frame = np.full((240, 320, 3), color, dtype=np.uint8)
        frame[30 + number : 80 + number, 80:130] = (70, 160, 80)
        cnn.add_sample(state, label, frame)
cnn.train(state)
image = np.full((240, 320, 3), (10, 20, 220), dtype=np.uint8)
label, confidence = cnn.predict(state, image)
assert label in state["classes"] and math.isfinite(confidence)
with tempfile.TemporaryDirectory() as folder:
    cnn.save_classifier(state, folder)
    restored = cnn.new_classifier(["red", "blue"])
    cnn.load_classifier(restored, folder)
    label2, confidence2 = cnn.predict(restored, image)
    assert label2 == label and abs(confidence2 - confidence) < 0.00001
    wrong = cnn.new_classifier(["blue", "red"])
    try:
        cnn.load_classifier(wrong, folder)
    except ValueError:
        pass
    else:
        raise AssertionError("Mismatched class order must be rejected")
print(
    "PASS: real MobileNetV2 embeddings, 30-epoch head training, prediction, .keras save/load, same inference without retraining."
)
