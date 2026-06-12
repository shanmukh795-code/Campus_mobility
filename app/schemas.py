from pydantic import BaseModel, EmailStr
from typing import Optional, List
import datetime

class UserBase(BaseModel):
    email: EmailStr
    name: str

class UserCreate(UserBase):
    password: str
    role: str # 'passenger' or 'driver'
    vehicle_info: Optional[str] = None # For drivers

class UserResponse(UserBase):
    id: int
    role: str
    is_online: Optional[bool] = None
    vehicle_info: Optional[str] = None
    verification_info: Optional[str] = None
    
    class Config:
        orm_mode = True

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    vehicle_info: Optional[str] = None
    verification_info: Optional[str] = None

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class RideRequest(BaseModel):
    pickup_lat: float
    pickup_lng: float
    pickup_address: str
    dest_lat: float
    dest_lng: float
    dest_address: str

class RideResponse(RideRequest):
    id: int
    passenger_id: int
    driver_id: Optional[int] = None
    status: str
    created_at: datetime.datetime
    
    class Config:
        orm_mode = True

class RideUpdate(BaseModel):
    status: str # Accepted, In Progress, Completed, Cancelled
    driver_id: Optional[int] = None

class RatingCreate(BaseModel):
    ride_id: int
    score: int
    feedback: Optional[str] = None

class RideHistoryItem(RideResponse):
    rating_score: Optional[int] = None
    rating_feedback: Optional[str] = None
    formatted_time: Optional[str] = None
    pickup_time: Optional[str] = None
    dropoff_time: Optional[str] = None

class DriverStats(BaseModel):
    total_rides: int
    average_rating: float
    history: List[RideHistoryItem]

class DriverAvailabilityUpdate(BaseModel):
    is_online: bool
    current_lat: Optional[float] = None
    current_lng: Optional[float] = None
