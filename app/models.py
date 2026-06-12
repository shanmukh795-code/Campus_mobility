from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
import datetime
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    name = Column(String)
    role = Column(String) # "passenger" or "driver"
    
    # Driver specific
    vehicle_info = Column(String, nullable=True)
    verification_info = Column(String, nullable=True) # E.g. "License Verified"
    is_online = Column(Boolean, default=False)
    current_lat = Column(Float, nullable=True)
    current_lng = Column(Float, nullable=True)
    
    rides_as_passenger = relationship("Ride", foreign_keys="Ride.passenger_id", back_populates="passenger")
    rides_as_driver = relationship("Ride", foreign_keys="Ride.driver_id", back_populates="driver")

class Ride(Base):
    __tablename__ = "rides"

    id = Column(Integer, primary_key=True, index=True)
    passenger_id = Column(Integer, ForeignKey("users.id"))
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    pickup_lat = Column(Float)
    pickup_lng = Column(Float)
    pickup_address = Column(String)
    
    dest_lat = Column(Float)
    dest_lng = Column(Float)
    dest_address = Column(String)
    
    status = Column(String, default="Requested") # Requested, Accepted, In Progress, Completed, Cancelled
    rejected_by = Column(String, default="") # Comma separated driver IDs who rejected it
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    
    passenger = relationship("User", foreign_keys=[passenger_id], back_populates="rides_as_passenger")
    driver = relationship("User", foreign_keys=[driver_id], back_populates="rides_as_driver")
    rating = relationship("Rating", back_populates="ride", uselist=False)

class Rating(Base):
    __tablename__ = "ratings"

    id = Column(Integer, primary_key=True, index=True)
    ride_id = Column(Integer, ForeignKey("rides.id"))
    score = Column(Integer) # 1 to 5
    feedback = Column(String, nullable=True)
    
    ride = relationship("Ride", back_populates="rating")
