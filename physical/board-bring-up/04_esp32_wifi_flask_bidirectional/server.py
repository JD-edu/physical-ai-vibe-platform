from flask import Flask, request

app = Flask(__name__)
next_number = 0


@app.post("/exchange")
def receive():
    global next_number

    microbit_number = request.get_data(as_text=True).strip()
    print(f"micro:bit number: {microbit_number}", flush=True)

    response_number = str(next_number)
    next_number = (next_number + 1) % 10

    print(f"server number: {response_number}", flush=True)
    return response_number, 200, {"Content-Type": "text/plain; charset=utf-8"}


if __name__ == "__main__":
    print("MODE: BIDIRECTIONAL 0-9 (/exchange)", flush=True)
    app.run(host="0.0.0.0", port=5000)
