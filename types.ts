
export type UserType = 'passenger' | 'driver';

export type DriverStatus = 'online' | 'offline';

export type View = 'home' | 'passenger-register' | 'driver-register' | 'passenger-dashboard' | 'driver-dashboard' | 'searching' | 'trip-active' | 'rate-driver';

export type TripStatus = 'pending' | 'searching' | 'accepted';

export interface Location {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp?: number;
}

export interface Trip {
  id: number;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  destinationLat: number;
  destinationLng: number;
  destinationAddress: string;
  status: TripStatus;
  distance: number;
  price: number;
  passengerName?: string;
  passengerPhone?: string;
  passengerPhoto?: string;
  driverName?: string;
  driverPhone?: string;
  driverPlate?: string;
  driverLat?: number;
  driverLng?: number;
  driverPhoto?: string;
  vehiclePhotos?: string[];
}

export interface DriverProfile {
  name: string;
  documentNumber: string;
  phone: string;
  plate: string;
  rating: number;
  completedTrips: number;
  photo?: string;
  vehiclePhotos: string[];
}

export interface PassengerProfile {
  name: string;
  documentNumber: string;
  phone: string;
  rating: number;
  photo?: string;
}

export interface TripRequest {
  pickupLat: number | null;
  pickupLng: number | null;
  pickupAddress: string;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationAddress: string;
  distance: number;
  price: number;
}
