from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import json
import os

from . import models, schemas, auth, database
from .database import engine

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Campus Mobility API")

# Setup OAuth2
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception as e:
                print(f"Error broadcasting: {e}")

manager = ConnectionManager()

# Dependency to get current user
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(database.get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except auth.jwt.PyJWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

# API Routes

@app.post("/api/auth/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(
        email=user.email,
        name=user.name,
        hashed_password=hashed_password,
        role=user.role,
        vehicle_info=user.vehicle_info if user.role == 'driver' else None
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.post("/api/auth/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    
    access_token_expires = auth.timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email, "role": user.role, "id": user.id}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/me", response_model=schemas.UserResponse)
def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user

@app.put("/api/auth/profile", response_model=schemas.UserResponse)
def update_profile(profile_update: schemas.ProfileUpdate, current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if profile_update.name is not None:
        current_user.name = profile_update.name
    if current_user.role == 'driver':
        if profile_update.vehicle_info is not None:
            current_user.vehicle_info = profile_update.vehicle_info
        if profile_update.verification_info is not None:
            current_user.verification_info = profile_update.verification_info
    db.commit()
    db.refresh(current_user)
    return current_user

@app.post("/api/rides", response_model=schemas.RideResponse)
async def request_ride(ride: schemas.RideRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if current_user.role != 'passenger':
        raise HTTPException(status_code=403, detail="Only passengers can request rides")
        
    db_ride = models.Ride(
        passenger_id=current_user.id,
        pickup_lat=ride.pickup_lat,
        pickup_lng=ride.pickup_lng,
        pickup_address=ride.pickup_address,
        dest_lat=ride.dest_lat,
        dest_lng=ride.dest_lng,
        dest_address=ride.dest_address,
        status="Requested"
    )
    db.add(db_ride)
    db.commit()
    db.refresh(db_ride)
    
    # Broadcast to drivers
    await manager.broadcast({
        "type": "NEW_RIDE_REQUEST",
        "data": {
            "id": db_ride.id,
            "pickup_address": db_ride.pickup_address,
            "dest_address": db_ride.dest_address,
            "passenger_name": current_user.name
        }
    })
    
    return db_ride

@app.get("/api/rides", response_model=list[schemas.RideResponse])
def get_rides(current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if current_user.role == 'driver':
        rides = db.query(models.Ride).filter((models.Ride.driver_id == current_user.id) | (models.Ride.status == "Requested")).all()
        # Filter out rides rejected by this driver
        driver_str = str(current_user.id)
        filtered_rides = []
        for r in rides:
            rejected_list = r.rejected_by.split(",") if r.rejected_by else []
            if driver_str not in rejected_list:
                filtered_rides.append(r)
        return filtered_rides
    else:
        return db.query(models.Ride).filter(models.Ride.passenger_id == current_user.id).all()

@app.put("/api/rides/{ride_id}", response_model=schemas.RideResponse)
async def update_ride(ride_id: int, ride_update: schemas.RideUpdate, current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    db_ride = db.query(models.Ride).filter(models.Ride.id == ride_id).first()
    if not db_ride:
        raise HTTPException(status_code=404, detail="Ride not found")
        
    if current_user.role == 'driver':
        if ride_update.status == "Accepted":
            if db_ride.status != "Requested":
                raise HTTPException(status_code=400, detail="Ride already accepted by someone else")
            db_ride.driver_id = current_user.id
            db_ride.status = "Accepted"
        else:
            if db_ride.driver_id != current_user.id:
                raise HTTPException(status_code=403, detail="Not your ride")
            db_ride.status = ride_update.status
            
    elif current_user.role == 'passenger':
        if db_ride.passenger_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not your ride")
        if ride_update.status == "Cancelled":
            if db_ride.status not in ["Requested", "Accepted"]:
                raise HTTPException(status_code=400, detail="Cannot cancel an in-progress ride")
            db_ride.status = "Cancelled"
            
    db.commit()
    db.refresh(db_ride)
    
    # Broadcast update
    await manager.broadcast({
        "type": "RIDE_UPDATED",
        "data": {
            "id": db_ride.id,
            "status": db_ride.status,
            "driver_id": db_ride.driver_id
        }
    })
    
    return db_ride

@app.put("/api/drivers/availability")
async def update_availability(availability: schemas.DriverAvailabilityUpdate, current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if current_user.role != 'driver':
        raise HTTPException(status_code=403, detail="Only drivers can update availability")
        
    current_user.is_online = availability.is_online
    if availability.current_lat:
        current_user.current_lat = availability.current_lat
    if availability.current_lng:
        current_user.current_lng = availability.current_lng
        
    db.commit()
    
    # Broadcast driver location update
    if current_user.is_online:
        await manager.broadcast({
            "type": "DRIVER_LOCATION_UPDATED",
            "data": {
                "driver_id": current_user.id,
                "lat": current_user.current_lat,
                "lng": current_user.current_lng
            }
        })
        
    return {"status": "success"}

@app.get("/api/drivers/available", response_model=list[schemas.UserResponse])
def get_available_drivers(current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    return db.query(models.User).filter(models.User.role == 'driver', models.User.is_online == True).all()

@app.post("/api/rides/{ride_id}/reject")
def reject_ride(ride_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if current_user.role != 'driver':
        raise HTTPException(status_code=403, detail="Only drivers can reject requests")
    db_ride = db.query(models.Ride).filter(models.Ride.id == ride_id).first()
    if not db_ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    
    rejected_list = db_ride.rejected_by.split(",") if db_ride.rejected_by else []
    if str(current_user.id) not in rejected_list:
        rejected_list.append(str(current_user.id))
        db_ride.rejected_by = ",".join(rejected_list)
        db.commit()
    return {"status": "rejected"}

@app.post("/api/ratings")
def submit_rating(rating: schemas.RatingCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    db_ride = db.query(models.Ride).filter(models.Ride.id == rating.ride_id).first()
    if not db_ride or db_ride.passenger_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your ride")
    
    db_rating = models.Rating(ride_id=rating.ride_id, score=rating.score, feedback=rating.feedback)
    db.add(db_rating)
    db.commit()
    
    # Notify driver to update stats
    import asyncio
    asyncio.create_task(manager.broadcast({
        "type": "DRIVER_STATS_UPDATED",
        "data": { "driver_id": db_ride.driver_id }
    }))
    
    return {"status": "success"}

@app.get("/api/drivers/stats", response_model=schemas.DriverStats)
def get_driver_stats(current_user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if current_user.role != 'driver':
        raise HTTPException(status_code=403, detail="Only drivers can view stats")
    
    history = db.query(models.Ride).filter(models.Ride.driver_id == current_user.id, models.Ride.status == 'Completed').all()
    total_rides = len(history)
    
    ratings = db.query(models.Rating).join(models.Ride).filter(models.Ride.driver_id == current_user.id).all()
    ratings_by_ride = {r.ride_id: r for r in ratings}
    
    avg_rating = sum([r.score for r in ratings]) / len(ratings) if ratings else 0.0
    
    history_items = []
    for r in history:
        item = r.__dict__.copy()
        if r.id in ratings_by_ride:
            item['rating_score'] = ratings_by_ride[r.id].score
            item['rating_feedback'] = ratings_by_ride[r.id].feedback
        else:
            item['rating_score'] = None
            item['rating_feedback'] = None
            
        item['formatted_time'] = r.created_at.isoformat() + "Z"
        item['pickup_time'] = r.created_at.isoformat() + "Z"
        item['dropoff_time'] = r.updated_at.isoformat() + "Z" if r.updated_at else "N/A"
        history_items.append(item)
    
    return {
        "total_rides": total_rides,
        "average_rating": avg_rating,
        "history": history_items
    }

# WebSockets endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming WebSocket messages if needed
            # For now, we mainly use it for broadcasting server->client
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Mount static files for frontend
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
