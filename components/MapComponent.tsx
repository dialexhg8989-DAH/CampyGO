
import React, { useEffect, useRef } from 'react';

// Leaflet is loaded via CDN in index.html, so we declare it here to avoid TS errors
declare const L: any;

interface MapProps {
  lat: number;
  lng: number;
  destinationLat?: number | null;
  destinationLng?: number | null;
  popupText?: string;
  className?: string;
  iconType?: 'default' | 'moto' | 'person';
}

const MapComponent: React.FC<MapProps> = ({ 
  lat, 
  lng, 
  destinationLat, 
  destinationLng, 
  popupText, 
  className = "h-48 w-full", 
  iconType = 'default' 
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const destinationMarkerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const prevCoordsRef = useRef({ lat, lng, dLat: destinationLat, dLng: destinationLng });

  useEffect(() => {
    if (!mapContainerRef.current || typeof L === 'undefined') return;

    // Define Icons
    const defaultIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background-color: #2563eb; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.3);"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const motoIconSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px; color: white;">
        <path d="M18.5 14a3.5 3.5 0 1 0-3.5 3.5A3.5 3.5 0 0 0 18.5 14Zm-13 0a3.5 3.5 0 1 0-3.5 3.5A3.5 3.5 0 0 0 5.5 14Z"/>
        <path d="M15 5a1 1 0 0 0-1 1h-3.5l-3 6 4 1 2-3h3v1.5a1.5 1.5 0 0 1-3 0V11H9.2l-2.6 3.9A5.48 5.48 0 0 1 2 14v2a3.5 3.5 0 0 0 3.5 3.5h13A3.5 3.5 0 0 0 22 16v-2.5l-2-4.5Z"/>
      </svg>
    `;

    const motoIcon = L.divIcon({
      className: 'custom-moto-icon',
      html: `<div style="background-color: #10b981; display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%; border: 4px solid white; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);">
              ${motoIconSvg}
             </div>`,
      iconSize: [48, 48],
      iconAnchor: [24, 24], 
      popupAnchor: [0, -24]
    });

    const destinationIcon = L.divIcon({
      className: 'destination-icon',
      html: `<div style="background-color: #ef4444; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.3); position: relative;">
                <div style="position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%); width: 2px; height: 8px; background: #ef4444;"></div>
             </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 24]
    });

    const currentIcon = iconType === 'moto' ? motoIcon : defaultIcon;

    // Initialize map if not exists
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapContainerRef.current, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: false,
        attributionControl: false
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapInstanceRef.current);
      
      markerRef.current = L.marker([lat, lng], { icon: currentIcon }).addTo(mapInstanceRef.current);
      if (popupText) markerRef.current.bindPopup(popupText).openPopup();

    } else {
      // SMOOTH ANIMATION: Update marker position without re-initializing
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
        markerRef.current.setIcon(currentIcon);
        
        // Only pan if we moved significantly (avoids jittering when user tries to pan)
        const mapCenter = mapInstanceRef.current.getCenter();
        const dist = Math.sqrt(Math.pow(mapCenter.lat - lat, 2) + Math.pow(mapCenter.lng - lng, 2));
        if (dist > 0.005) {
             mapInstanceRef.current.panTo([lat, lng]);
        }
      }
    }

    // Update Destination Marker
    if (destinationLat && destinationLng) {
      if (!destinationMarkerRef.current) {
        destinationMarkerRef.current = L.marker([destinationLat, destinationLng], { icon: destinationIcon }).addTo(mapInstanceRef.current);
      } else {
        destinationMarkerRef.current.setLatLng([destinationLat, destinationLng]);
      }
    } else {
      if (destinationMarkerRef.current) {
        mapInstanceRef.current.removeLayer(destinationMarkerRef.current);
        destinationMarkerRef.current = null;
      }
    }

    // Route Drawing Logic (with Debounce to avoid spamming OSRM)
    const hasDestChanged = prevCoordsRef.current.dLat !== destinationLat || prevCoordsRef.current.dLng !== destinationLng;
    const hasOriginChangedSignificantly = Math.abs(prevCoordsRef.current.lat - lat) > 0.002 || Math.abs(prevCoordsRef.current.lng - lng) > 0.002;

    if ((destinationLat && destinationLng) && (hasDestChanged || hasOriginChangedSignificantly || !routeLayerRef.current)) {
        
        const fetchRoute = async () => {
             try {
                 const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destinationLng},${destinationLat}?overview=full&geometries=geojson`);
                 const data = await res.json();
                 
                 if (data.routes && data.routes.length > 0) {
                    if (routeLayerRef.current) mapInstanceRef.current.removeLayer(routeLayerRef.current);
                    
                    routeLayerRef.current = L.geoJSON(data.routes[0].geometry, {
                        style: { color: '#2563eb', weight: 6, opacity: 0.6, lineCap: 'round', lineJoin: 'round' }
                    }).addTo(mapInstanceRef.current);

                    // Fit bounds to show whole trip
                    mapInstanceRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [50, 50] });
                 }
             } catch (e) {
                 // Fallback straight line
                 if (routeLayerRef.current) mapInstanceRef.current.removeLayer(routeLayerRef.current);
                 const line = [[lat, lng], [destinationLat, destinationLng]];
                 routeLayerRef.current = L.polyline(line, { color: '#2563eb', weight: 4, dashArray: '5, 10' }).addTo(mapInstanceRef.current);
             }
        };
        
        fetchRoute();
    }

    prevCoordsRef.current = { lat, lng, dLat: destinationLat, dLng: destinationLng };

    // Fix for map resize issues
    setTimeout(() => { mapInstanceRef.current?.invalidateSize(); }, 200);

  }, [lat, lng, destinationLat, destinationLng, iconType, popupText]);

  return (
    <div className={`relative overflow-hidden rounded-3xl shadow-inner bg-slate-100 ${className}`}>
        <div ref={mapContainerRef} className="w-full h-full z-0 mix-blend-multiply" />
        {/* Decorative Overlay for Map */}
        <div className="absolute top-0 left-0 w-full h-12 bg-gradient-to-b from-white/50 to-transparent pointer-events-none z-[400]"></div>
    </div>
  );
};

export default MapComponent;
