import requests
import json
import time

BASE_URL = "http://127.0.0.1:8000/api"

print("1. Registering Passenger...")
res = requests.post(f"{BASE_URL}/auth/register", json={
    "email": "pass1@test.com", "name": "Passenger 1", "password": "pass", "role": "passenger"
})
print("Passenger Register:", res.status_code, res.text)

print("\n2. Registering Driver...")
res = requests.post(f"{BASE_URL}/auth/register", json={
    "email": "drv1@test.com", "name": "Driver 1", "password": "pass", "role": "driver", "vehicle_info": "E-Rickshaw 001"
})
print("Driver Register:", res.status_code, res.text)

print("\n3. Login Passenger...")
res = requests.post(f"{BASE_URL}/auth/login", data={"username": "pass1@test.com", "password": "pass"})
pass_token = res.json().get("access_token")
print("Passenger Token:", pass_token is not None)

print("\n4. Login Driver...")
res = requests.post(f"{BASE_URL}/auth/login", data={"username": "drv1@test.com", "password": "pass"})
drv_token = res.json().get("access_token")
print("Driver Token:", drv_token is not None)

print("\n5. Passenger requests ride...")
res = requests.post(f"{BASE_URL}/rides", headers={"Authorization": f"Bearer {pass_token}"}, json={
    "pickup_lat": 0, "pickup_lng": 0, "pickup_address": "Gate",
    "dest_lat": 0, "dest_lng": 0, "dest_address": "Library"
})
print("Ride Request:", res.status_code, res.text)
ride_id = res.json().get("id")

print("\n6. Driver accepts ride...")
res = requests.put(f"{BASE_URL}/rides/{ride_id}", headers={"Authorization": f"Bearer {drv_token}"}, json={
    "status": "Accepted", "driver_id": 2
})
print("Ride Accept:", res.status_code, res.text)

print("\n7. Driver completes ride...")
res = requests.put(f"{BASE_URL}/rides/{ride_id}", headers={"Authorization": f"Bearer {drv_token}"}, json={
    "status": "Completed", "driver_id": 2
})
print("Ride Complete:", res.status_code, res.text)
