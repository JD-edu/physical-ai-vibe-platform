import importlib.util
spec=importlib.util.spec_from_file_location('bridge','physical/bridge-server/server.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
client=m.app.test_client()
assert client.get('/api/status').headers['Access-Control-Allow-Origin']=='*'
assert client.options('/api/command').headers['Access-Control-Allow-Headers']=='Content-Type'
assert client.post('/api/command',json={'command':'CMD:servo:90'}).status_code==503
assert client.post('/api/command',json={'command':'A\nB'}).status_code==400
class Device:
    def sendall(self,data): self.data=data
fake=Device();m.esp32_clients.append(fake)
r=client.post('/api/command',json={'command':'CMD:servo:90'})
assert r.status_code==200 and r.json['sent_count']==1 and fake.data==b'CMD:servo:90\n'
for _ in range(2): assert client.post('/receive',data='DATA:temperature:25').status_code==200
status=client.get('/api/status').json
assert [x['id'] for x in status['message_history']]==[2,1]
assert status['message_sequence']==2
print('Bridge checks passed: CORS, preflight, command validation, offline failure, TCP forwarding, distinct repeated messages.')

response=client.post('/exchange',data='DATA:humidity:58')
assert response.status_code==200 and response.text=='DATA:humidity:58'
status=client.get('/api/status').json
assert status['latest_message']=='DATA:humidity:58' and status['message_sequence']==3
assert client.post('/exchange',data='').status_code==400
print('Step 5 exchange compatibility checks passed.')

response=client.post('/api/command',json={'command':' A '})
assert response.status_code==200 and fake.data==b' A \n'
print('Literal payload whitespace preservation passed.')
