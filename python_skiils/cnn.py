"""실제 Python CNN: 샘플 수집 → 작은 분류기 학습 → 추론 → 저장/복원.

MobileNetV2는 이미 학습된 특징 추출기입니다. 이 부분은 고정하고 새 분류기만 학습합니다.
브라우저 TensorFlow.js 모델 파일과 Python Keras 모델 파일은 서로 다른 형식입니다.
"""

from pathlib import Path
from files import read_json, write_json

MODEL_NAME = "keras-mobilenet-v2-alpha-0.5"


def new_classifier(classes):
    samples = {}
    for label in classes:
        samples[label] = []
    return {
        "classes": list(classes),
        "samples": samples,
        "backbone": None,
        "head": None,
    }


def prepare_model(state):
    if state["backbone"] is not None:
        return
    try:
        import tensorflow as tf
    except ImportError as error:
        raise ValueError(
            "CNN 설치 필요: pip install -r requirements-cnn.txt"
        ) from error
    # 작은 PC에서도 과도한 CPU 스레드를 만들지 않도록 제한합니다.
    try:
        tf.config.threading.set_intra_op_parallelism_threads(2)
        tf.config.threading.set_inter_op_parallelism_threads(2)
    except RuntimeError:
        pass
    backbone = tf.keras.applications.MobileNetV2(
        input_shape=(224, 224, 3),
        alpha=0.5,
        include_top=False,
        weights="imagenet",
        pooling="avg",
    )
    backbone.trainable = False
    state["backbone"] = backbone


def extract_features(state, frame):
    import cv2
    import numpy as np

    prepare_model(state)
    import tensorflow as tf

    height, width = frame.shape[:2]
    side = min(height, width)
    top = (height - side) // 2
    left = (width - side) // 2
    image = frame[top : top + side, left : left + side]
    image = cv2.resize(image, (224, 224))
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    image = image.astype("float32")
    image = tf.keras.applications.mobilenet_v2.preprocess_input(image)
    batch = np.expand_dims(image, axis=0)
    return state["backbone"](batch, training=False).numpy()[0]


def add_sample(state, label, frame):
    if label not in state["samples"]:
        raise ValueError("알 수 없는 클래스입니다.")
    if len(state["samples"][label]) >= 200:
        raise ValueError("클래스마다 최대 200장입니다.")
    features = extract_features(state, frame)
    state["samples"][label].append(features)
    state["head"] = None  # 새 샘플이 추가되면 다시 학습해야 합니다.


def train(state, progress=None, epochs=30):
    import numpy as np

    prepare_model(state)
    import tensorflow as tf

    rows = []
    labels = []
    for number, label in enumerate(state["classes"]):
        if len(state["samples"][label]) < 5:
            raise ValueError("각 클래스에 최소 5장의 샘플이 필요합니다.")
        for features in state["samples"][label]:
            rows.append(features)
            labels.append(number)
    x = np.array(rows, dtype="float32")
    y = np.array(labels, dtype="int32")
    head = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(x.shape[1],)),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dense(len(state["classes"]), activation="softmax"),
        ]
    )
    head.compile(
        optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"]
    )
    # 학습을 직접 반복해서 진행 상황을 보여 줍니다. 별도의 데이터 로더는 필요 없습니다.
    for epoch in range(epochs):
        order = np.random.permutation(len(x))
        for start in range(0, len(x), 16):
            indexes = order[start : start + 16]
            result = head.train_on_batch(x[indexes], y[indexes], return_dict=True)
        if progress is not None:
            progress(
                "학습 "
                + str(epoch + 1)
                + "/"
                + str(epochs)
                + " 손실 "
                + str(round(float(result["loss"]), 3))
            )
    state["head"] = head


def predict(state, frame):
    import numpy as np

    if state["head"] is None:
        raise ValueError("먼저 학습하거나 저장한 모델을 불러오세요.")
    features = extract_features(state, frame)
    scores = state["head"](np.expand_dims(features, axis=0), training=False).numpy()[0]
    number = int(np.argmax(scores))
    return state["classes"][number], float(scores[number])


def save_classifier(state, folder):
    if state["head"] is None:
        raise ValueError("학습한 모델이 없습니다.")
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    state["head"].save(folder / "head.keras")
    write_json(
        folder / "metadata.json",
        {"version": 1, "model": MODEL_NAME, "classes": state["classes"]},
    )


def load_classifier(state, folder):
    folder = Path(folder)
    metadata = read_json(folder / "metadata.json")
    if (
        metadata.get("version") != 1
        or metadata.get("model") != MODEL_NAME
        or metadata.get("classes") != state["classes"]
    ):
        raise ValueError("모델 종류나 클래스 순서가 현재 앱과 다릅니다.")
    prepare_model(state)
    import tensorflow as tf

    head = tf.keras.models.load_model(
        folder / "head.keras", compile=False, safe_mode=True
    )
    if head.input_shape[-1] != state["backbone"].output_shape[-1] or head.output_shape[
        -1
    ] != len(state["classes"]):
        raise ValueError("모델의 입력·출력 크기가 맞지 않습니다.")
    state["head"] = head
