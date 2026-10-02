from flask import Flask, request

app = Flask(__name__)


@app.post("/send")
def receive():
    number = request.get_data(as_text=True).strip()
    print(f"micro:bit number: {number}", flush=True)
    return "OK", 200


if __name__ == "__main__":
    print("MODE: SEND ONLY (/send)", flush=True)
    app.run(host="0.0.0.0", port=5000)
