
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { UserType, View, DriverStatus, Location, Trip, DriverProfile, PassengerProfile, TripRequest } from './types';
import LogoComponent from './components/LogoComponent';
import MapComponent from './components/MapComponent';
import { MapPin, User, Bike, Star, Phone, Navigation, ArrowLeft, LogOut, Camera, Mic, Clock } from './components/icons';
import { getAddressFromCoords, calculateDistance, calculatePrice, getCurrentLocation } from './services/locationService';

// Extend window to support speech recognition types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const App: React.FC = () => {
  // --- STATE ---
  const [userType, setUserType] = useState<UserType | null>(null);
  const [currentView, setCurrentView] = useState<View>('home');
  const [driverStatus, setDriverStatus] = useState<DriverStatus>('offline');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [userLocation, setUserLocation] = useState<Location | null>(null);
  const [isFetchingLocation, setIsFetchingLocation] = useState<boolean>(false);

  // Voice Assistant State
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false); // Master switch for voice
  
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);
  const processingRef = useRef<boolean>(false); 
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null); // For keeping voice alive

  // Profiles
  const [driverProfile, setDriverProfile] = useState<DriverProfile>({
    name: '',
    documentNumber: '',
    phone: '',
    plate: '',
    rating: 4.8,
    completedTrips: 12,
    vehiclePhotos: []
  });

  const [passengerProfile, setPassengerProfile] = useState<PassengerProfile>({
    name: '',
    documentNumber: '',
    phone: '',
    rating: 5.0
  });

  const [tripRequest, setTripRequest] = useState<TripRequest>({
    pickupLat: null,
    pickupLng: null,
    pickupAddress: '',
    destinationLat: null,
    destinationLng: null,
    destinationAddress: '',
    distance: 0,
    price: 0
  });

  // --- STATE REF PATTERN (Crucial for Voice Closure) ---
  const stateRef = useRef({
    currentView,
    userType,
    driverProfile,
    passengerProfile,
    tripRequest,
    activeTrip,
    aiSpeaking,
    voiceActive,
    userLocation,
    isListening
  });

  useEffect(() => {
    stateRef.current = {
      currentView,
      userType,
      driverProfile: { ...driverProfile },
      passengerProfile: { ...passengerProfile },
      tripRequest: { ...tripRequest },
      activeTrip: activeTrip ? { ...activeTrip } : null,
      aiSpeaking,
      voiceActive,
      userLocation,
      isListening
    };
    
    processingRef.current = isProcessing;
  }, [currentView, userType, driverProfile, passengerProfile, tripRequest, activeTrip, aiSpeaking, isProcessing, voiceActive, userLocation, isListening]);

  // --- SIMULATION ENGINE ---
  useEffect(() => {
    let simInterval: any;
    
    if (activeTrip && activeTrip.status === 'accepted' && userType === 'passenger') {
        simInterval = setInterval(() => {
            setActiveTrip(prev => {
                if (!prev || !prev.driverLat || !prev.driverLng) return prev;

                const speed = 0.0005; 
                const targetLat = prev.pickupLat;
                const targetLng = prev.pickupLng;

                const dy = targetLat - prev.driverLat;
                const dx = targetLng - prev.driverLng;
                const distance = Math.sqrt(dx*dx + dy*dy);

                if (distance < 0.0005) {
                    return { ...prev, driverLat: targetLat, driverLng: targetLng }; 
                }

                const angle = Math.atan2(dy, dx);
                const moveY = Math.sin(angle) * speed;
                const moveX = Math.cos(angle) * speed;

                return {
                    ...prev,
                    driverLat: prev.driverLat + moveY,
                    driverLng: prev.driverLng + moveX
                };
            });
        }, 1000);
    }
    return () => clearInterval(simInterval);
  }, [activeTrip, userType]);


  // --- ROBUST VOICE LOGIC ---

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    
    // STRICT CONDITIONS: Don't listen if talking, processing, or already listening
    if (stateRef.current.aiSpeaking || processingRef.current || stateRef.current.isListening) return;

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e: any) {
      // Ignore "already started" errors
      if (e.error !== 'not-allowed' && e.message?.indexOf('active') === -1) {
         // console.error(e); 
      }
    }
  }, []);

  const stopListening = useCallback(() => {
      if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch(e) {}
      }
      setIsListening(false);
  }, []);

  // HEARTBEAT: Ensures voice never dies
  useEffect(() => {
      if (voiceActive) {
          heartbeatRef.current = setInterval(() => {
              // If we want to be listening, but we aren't, and AI isn't busy... RESTART
              if (!stateRef.current.isListening && !stateRef.current.aiSpeaking && !processingRef.current) {
                  console.log("Heartbeat: Restarting voice...");
                  startListening();
              }
          }, 2000);
      } else {
          if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      }
      return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [voiceActive, startListening]);


  const speak = useCallback((text: string) => {
    // 1. Kill any current audio
    if (synthRef.current.speaking || synthRef.current.pending) {
        synthRef.current.cancel();
    }
    
    // 2. Stop listening explicitly
    stopListening();

    setAiSpeaking(true);
    setIsProcessing(false); // Ensure processing is done when we speak

    // 3. Short delay to let microphone hardware release
    setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-CO';
        utterance.rate = 1.0; 
        utterance.pitch = 1.0;
        
        const voices = synthRef.current.getVoices();
        const preferredVoice = voices.find(v => v.name.includes('Google') && v.lang.includes('es')) || voices.find(v => v.lang.includes('es'));
        if (preferredVoice) utterance.voice = preferredVoice;

        const resumeListening = () => {
            setAiSpeaking(false);
            if (stateRef.current.voiceActive) {
                // Small delay before reopening mic prevents "hearing itself"
                setTimeout(startListening, 200);
            }
        };

        utterance.onend = resumeListening;
        utterance.onerror = resumeListening;

        synthRef.current.speak(utterance);
    }, 50);
  }, [startListening, stopListening]);

  // Init Recognition
  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // Safer for mobile browsers
      recognition.interimResults = false;
      recognition.lang = 'es-CO';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListening(true);
      
      recognition.onend = () => {
        setIsListening(false);
        // NOTE: The Heartbeat interval will pick this up and restart it automatically
        // We don't need to aggressively restart here to avoid loops
      };

      recognition.onresult = (event: any) => {
        const result = event.results[event.resultIndex][0].transcript;
        if (result.trim().length > 0) {
             processVoiceCommand(result);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
            // For real errors, wait a bit then retry via heartbeat
            setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleVoiceAssistant = () => {
    const newState = !voiceActive;
    setVoiceActive(newState);
    if (newState) {
        speak("Hola, soy tu asistente. Dime tu nombre o a dónde quieres ir.");
    } else {
        synthRef.current.cancel();
        stopListening();
        setAiSpeaking(false);
        setTranscript('');
    }
  };

  // --- LOGIC PROCESSOR ---
  const processVoiceCommand = async (text: string) => {
    setTranscript(text);
    setIsProcessing(true);
    
    try {
        await getGeminiResponse(text, stateRef.current);
    } catch(e) {
        console.error(e);
        setIsProcessing(false);
        // Don't speak error endlessly, just let heartbeat resume
        if (stateRef.current.voiceActive) startListening();
    }
  };

  // --- GEMINI AI INTERPRETER ---
  const getGeminiResponse = async (text: string, currentState: any) => {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const contextObj = {
          currentView: currentState.currentView,
          userType: currentState.userType,
          // Send current field values so AI knows what's missing
          passengerName: currentState.passengerProfile.name,
          passengerPhone: currentState.passengerProfile.phone,
          driverName: currentState.driverProfile.name,
          driverPhone: currentState.driverProfile.phone,
          driverPlate: currentState.driverProfile.plate,
          tripDestination: currentState.tripRequest.destinationAddress
      };

      const systemPrompt = `
        Eres el asistente de la app de mototaxis CampyGo. Tu misión es ayudar al usuario a navegar y rellenar formularios.
        
        CONTEXTO APP: ${JSON.stringify(contextObj)}
        USUARIO DIJO: "${text}"
        
        INSTRUCCIONES:
        Identifica la intención del usuario y genera un JSON.
        
        ACCIONES DISPONIBLES:
        - "SET_PASSENGER_NAME": El usuario dice su nombre (ej: "Soy Juan", "Me llamo Pedro").
        - "SET_PASSENGER_PHONE": El usuario dice numeros de teléfono.
        - "SET_DRIVER_NAME": El usuario dice su nombre (en modo conductor).
        - "SET_DRIVER_PHONE": El usuario dice telefono (en modo conductor).
        - "SET_DRIVER_PLATE": El usuario dice una placa (letras y numeros, ej: "ABC 123").
        - "NAVIGATE_PASSENGER_REG": Usuario quiere ser pasajero.
        - "NAVIGATE_DRIVER_REG": Usuario quiere ser conductor.
        - "NAVIGATE_DESTINATION": Usuario dice un lugar para ir.
        - "CONFIRM_TRIP": Usuario dice "sí", "pedir", "confirmar".
        - "CANCEL": Usuario dice "cancelar", "volver".
        - "NONE": Solo charla.

        SALIDA JSON ESPERADA:
        {
            "speech": "Texto corto para que el asistente responda (max 15 palabras).",
            "action": "NOMBRE_DE_ACCION",
            "value": "Valor extraido limpio (ej: 'Juan Pérez', '3001234567', 'ABC123', 'Plaza Principal')"
        }

        Ejemplos:
        Usuario: "Me llamo Carlos Ruiz" -> { "action": "SET_PASSENGER_NAME", "value": "Carlos Ruiz", "speech": "Hola Carlos, ¿cuál es tu número?" }
        Usuario: "Mi teléfono es 310 555 9999" -> { "action": "SET_PASSENGER_PHONE", "value": "3105559999", "speech": "Guardado. ¿A dónde vamos?" }
        Usuario: "La placa es X Y Z 555" -> { "action": "SET_DRIVER_PLATE", "value": "XYZ555", "speech": "Placa registrada." }
      `;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: systemPrompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    speech: { type: Type.STRING },
                    action: { type: Type.STRING },
                    value: { type: Type.STRING },
                }
            }
        }
      });
      
      const resultText = response.text;
      if (!resultText) throw new Error("No response from AI");

      const data = JSON.parse(resultText);
      console.log("AI Action:", data);

      // --- EXECUTE ACTIONS ---
      let shouldSpeak = true;

      if (data.action) {
          switch(data.action) {
              case 'NAVIGATE_PASSENGER_REG':
                  setUserType('passenger');
                  setCurrentView('passenger-register');
                  break;
              case 'NAVIGATE_DRIVER_REG':
                  setUserType('driver');
                  setCurrentView('driver-register');
                  break;
              case 'SET_PASSENGER_NAME':
                  if (currentState.currentView === 'passenger-register' || currentState.currentView === 'home') {
                      if(currentState.currentView === 'home') { setUserType('passenger'); setCurrentView('passenger-register'); }
                      setPassengerProfile(p => ({ ...p, name: data.value }));
                  }
                  break;
              case 'SET_DRIVER_NAME':
                  if (currentState.currentView === 'driver-register' || currentState.currentView === 'home') {
                      if(currentState.currentView === 'home') { setUserType('driver'); setCurrentView('driver-register'); }
                      setDriverProfile(p => ({ ...p, name: data.value }));
                  }
                  break;
              case 'SET_PASSENGER_PHONE':
                  const cleanPhoneP = data.value.replace(/\D/g, '');
                  setPassengerProfile(p => ({ ...p, phone: cleanPhoneP }));
                  break;
              case 'SET_DRIVER_PHONE':
                  const cleanPhoneD = data.value.replace(/\D/g, '');
                  setDriverProfile(p => ({ ...p, phone: cleanPhoneD }));
                  break;
              case 'SET_DRIVER_PLATE':
                  const cleanPlate = data.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                  setDriverProfile(p => ({ ...p, plate: cleanPlate }));
                  break;
              case 'NAVIGATE_DESTINATION':
                  // If in register, ignore or move to dashboard first? Assuming dashboard for now or auto-transition
                  if (currentState.currentView === 'passenger-register') {
                      setCurrentView('passenger-dashboard');
                  }
                  handleSetDestination(data.value); 
                  break;
              case 'CONFIRM_TRIP':
                  if (currentState.currentView === 'passenger-dashboard' && currentState.tripRequest.destinationLat) {
                      requestTrip();
                  }
                  break;
              case 'CANCEL':
                  goBack();
                  break;
          }
      }
      
      if (shouldSpeak) {
          speak(data.speech || "Entendido.");
      } else {
          // If we don't speak, we must manually restart listener
          setIsProcessing(false);
          if (voiceActive) startListening();
      }
  };


  // --- STANDARD APP FUNCTIONS ---
  
  const handleGetCurrentLocation = async () => {
    setIsFetchingLocation(true);
    try {
      const location = await getCurrentLocation();
      const address = await getAddressFromCoords(location.lat, location.lng);
      setTripRequest(prev => ({ ...prev, pickupLat: location.lat, pickupLng: location.lng, pickupAddress: address }));
      setUserLocation({ ...location, accuracy: 10 });
    } catch(e) {
        speak("No pude obtener tu ubicación. Verifica el GPS.");
    } finally { setIsFetchingLocation(false); }
  };

  const handleSetDestination = async (overrideQuery?: string) => {
    if (!stateRef.current.tripRequest.pickupLat) {
        await handleGetCurrentLocation();
    }
    
    setIsFetchingLocation(true);
    // Simulation: In real app, we would geocode 'overrideQuery'
    // Here we just pick a random spot nearby for demo purposes
    const baseLat = stateRef.current.tripRequest.pickupLat || 4.60;
    const baseLng = stateRef.current.tripRequest.pickupLng || -74.08;
    
    // Random direction
    const latOffset = (Math.random() - 0.5) * 0.03;
    const lngOffset = (Math.random() - 0.5) * 0.03;

    const demoLat = baseLat + latOffset; 
    const demoLng = baseLng + lngOffset;
    
    const address = overrideQuery && overrideQuery.length > 3 ? overrideQuery : await getAddressFromCoords(demoLat, demoLng);
    const distance = calculateDistance(baseLat, baseLng, demoLat, demoLng);
    
    setTripRequest(prev => ({ ...prev, destinationLat: demoLat, destinationLng: demoLng, destinationAddress: address, distance, price: calculatePrice(distance) }));
    setIsFetchingLocation(false);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'driver' | 'passenger' | 'vehicle') => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (type === 'driver') setDriverProfile(prev => ({ ...prev, photo: result }));
        else if (type === 'passenger') setPassengerProfile(prev => ({ ...prev, photo: result }));
        else if (type === 'vehicle') setDriverProfile(prev => ({ ...prev, vehiclePhotos: [...prev.vehiclePhotos, result] }));
      };
      reader.readAsDataURL(file);
      speak("Foto recibida.");
    }
  };

  const requestTrip = () => {
    if (!stateRef.current.tripRequest.pickupLat || !stateRef.current.tripRequest.destinationLat) {
      speak("Primero necesito saber a dónde vas.");
      return;
    }
    
    const newTrip: Trip = {
      id: Date.now(),
      ...stateRef.current.tripRequest,
      status: 'searching',
      passengerName: stateRef.current.passengerProfile.name,
      passengerPhone: stateRef.current.passengerProfile.phone,
      passengerPhoto: stateRef.current.passengerProfile.photo,
      pickupLat: stateRef.current.tripRequest.pickupLat!,
      pickupLng: stateRef.current.tripRequest.pickupLng!,
      destinationLat: stateRef.current.tripRequest.destinationLat!,
      destinationLng: stateRef.current.tripRequest.destinationLng!
    };
    
    setActiveTrip(newTrip);
    setCurrentView('searching');
    
    setTimeout(() => {
        setActiveTrip(prev => ({
          ...prev!,
          status: 'accepted',
          driverName: 'Juan Pérez',
          driverPhone: '310 555 1234',
          driverPlate: 'XYZ-123',
          driverPhoto: 'https://ui-avatars.com/api/?name=Juan+P&background=0D8ABC&color=fff',
          driverLat: prev!.pickupLat - 0.005,
          driverLng: prev!.pickupLng - 0.005,
        }));
        setCurrentView('trip-active');
        speak("¡Conductor encontrado! Juan viene en camino.");
    }, 4000);
  };

  const completeTrip = () => {
    if (userType === 'passenger') {
        setCurrentView('rate-driver');
        speak("Hemos llegado. ¿Cuántas estrellas para el conductor?");
    } else {
        setDriverProfile(prev => ({ ...prev, completedTrips: prev.completedTrips + 1 }));
        setActiveTrip(null);
        setTripRequest({ pickupLat: null, pickupLng: null, pickupAddress: '', destinationLat: null, destinationLng: null, destinationAddress: '', distance: 0, price: 0 });
        setCurrentView('driver-dashboard');
        speak("Viaje terminado.");
    }
  };

  const submitRating = (rating: number) => {
      setActiveTrip(null);
      setTripRequest({ pickupLat: null, pickupLng: null, pickupAddress: '', destinationLat: null, destinationLng: null, destinationAddress: '', distance: 0, price: 0 });
      setCurrentView('passenger-dashboard');
      speak(`Gracias por calificar con ${rating} estrellas.`);
  };

  const goBack = () => {
    const view = stateRef.current.currentView;
    if (view.includes('register')) { setCurrentView('home'); setUserType(null); }
    else if (view === 'searching') { setCurrentView('passenger-dashboard'); setActiveTrip(null); }
    else if (view === 'driver-dashboard') { setCurrentView('home'); setDriverStatus('offline'); setUserType(null); }
    else if (view === 'passenger-dashboard') { setCurrentView('home'); setUserType(null); }
    else if (view === 'rate-driver') { submitRating(5); }
  };

  // --- RENDERERS ---

  const renderVoiceIndicator = () => {
    if (!voiceActive) return (
        <button onClick={toggleVoiceAssistant} className="fixed bottom-6 right-6 z-50 w-16 h-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full shadow-xl flex items-center justify-center text-white hover:scale-110 transition-transform ring-4 ring-white/30 animate-in zoom-in">
            <Mic className="w-8 h-8" />
        </button>
    );

    return (
        <div className="fixed bottom-0 left-0 w-full z-[1000] flex flex-col items-center justify-end pb-8 pointer-events-none">
            {/* Transcript Bubble */}
            {(transcript || aiSpeaking) && (
                 <div className="mb-4 bg-slate-900/90 backdrop-blur-xl text-white px-8 py-6 rounded-[2rem] max-w-[85%] shadow-2xl border border-white/10 animate-in slide-in-from-bottom-10 duration-300">
                     <p className="text-center text-xl font-medium leading-relaxed">
                        {aiSpeaking ? (
                            <span className="flex items-center justify-center gap-2 h-8">
                                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></span>
                                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-75"></span>
                                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-150"></span>
                            </span>
                        ) : transcript || "Escuchando..."}
                     </p>
                 </div>
            )}

            {/* Interactive Orb */}
            <button onClick={toggleVoiceAssistant} className="pointer-events-auto relative group cursor-pointer">
                {isListening && (
                   <>
                     <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-20 duration-1000"></div>
                     <div className="absolute inset-[-10px] bg-emerald-500 rounded-full animate-pulse opacity-10"></div>
                   </>
                )}
                
                <div className={`w-20 h-20 rounded-full shadow-[0_0_40px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-300 border-4 border-white/20 backdrop-blur-sm
                    ${isListening ? 'bg-gradient-to-tr from-emerald-400 to-teal-500 scale-110' : 
                      isProcessing ? 'bg-gradient-to-tr from-violet-600 to-fuchsia-600 rotate-180' : 
                      'bg-gradient-to-tr from-blue-600 to-cyan-500'}`}>
                    
                    {isProcessing ? (
                        <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                        <Mic className={`w-8 h-8 text-white transition-transform ${isListening ? 'scale-110' : ''}`} />
                    )}
                </div>
            </button>
        </div>
    );
  };

  const renderContent = () => {
    switch (currentView) {
      case 'home':
        return (
          <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-slate-900">
            <div className="absolute inset-0 z-0">
                <img src="https://images.unsplash.com/photo-1558981285-6f0c94958bb6?auto=format&fit=crop&w=1000&q=80" className="w-full h-full object-cover opacity-30" alt="Motorcycle" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent"></div>
            </div>

            <div className="relative z-10 w-full max-w-md flex flex-col items-center gap-8 animate-in fade-in zoom-in duration-700">
              <div className="bg-white/5 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-2xl border border-white/10">
                  <LogoComponent size="large" />
              </div>
              
              <div className="text-center">
                  <h1 className="text-5xl font-black text-white tracking-tighter mb-2 drop-shadow-2xl">CampyGo</h1>
                  <p className="text-blue-200 text-lg font-medium">Tu transporte rural seguro</p>
              </div>

              <div className="w-full space-y-4 mt-8">
                <button onClick={() => { setUserType('passenger'); setCurrentView('passenger-register'); }} className="group w-full bg-gradient-to-r from-white/95 to-white/80 hover:from-white hover:to-white backdrop-blur-md text-slate-900 p-5 rounded-3xl shadow-lg transition-all transform hover:-translate-y-1 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                      <div className="bg-blue-100 p-3 rounded-2xl text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition duration-300"><User className="w-7 h-7" /></div>
                      <div className="text-left">
                          <p className="font-black text-xl">Soy Pasajero</p>
                          <p className="text-slate-500 text-sm font-medium">Necesito un viaje</p>
                      </div>
                  </div>
                  <ArrowLeft className="w-6 h-6 rotate-180 text-slate-300 group-hover:text-slate-900 transition" />
                </button>

                <button onClick={() => { setUserType('driver'); setCurrentView('driver-register'); }} className="group w-full bg-slate-800/60 hover:bg-slate-800/80 backdrop-blur-md text-white p-5 rounded-3xl shadow-lg transition-all transform hover:-translate-y-1 flex items-center justify-between border border-white/10">
                   <div className="flex items-center gap-4">
                      <div className="bg-emerald-500/20 p-3 rounded-2xl text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white transition duration-300"><Bike className="w-7 h-7" /></div>
                      <div className="text-left">
                          <p className="font-black text-xl">Soy Conductor</p>
                          <p className="text-slate-400 text-sm font-medium">Quiero trabajar</p>
                      </div>
                  </div>
                  <ArrowLeft className="w-6 h-6 rotate-180 text-slate-600 group-hover:text-white transition" />
                </button>
              </div>
            </div>
          </div>
        );

      case 'passenger-register':
      case 'driver-register':
         const isDriver = currentView === 'driver-register';
         const profile = isDriver ? driverProfile : passengerProfile;
         
         return (
            <div className="min-h-screen bg-gray-50 flex flex-col">
                <div className="bg-white p-4 shadow-sm flex items-center gap-4 sticky top-0 z-20">
                    <button onClick={goBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-6 h-6 text-gray-800"/></button>
                    <h2 className="text-xl font-bold text-gray-800">{isDriver ? 'Registro Conductor' : 'Registro Pasajero'}</h2>
                </div>

                <div className="flex-1 p-6 flex flex-col items-center max-w-md mx-auto w-full animate-in slide-in-from-right duration-300">
                    <div className="relative mb-8 group cursor-pointer">
                        <div className={`w-36 h-36 rounded-full overflow-hidden border-[6px] ${isDriver ? 'border-emerald-400' : 'border-blue-400'} shadow-2xl bg-white`}>
                            {profile.photo ? <img src={profile.photo} className="w-full h-full object-cover" /> : <User className="w-full h-full p-8 text-gray-200" />}
                        </div>
                        <div className="absolute bottom-0 right-0 bg-slate-900 text-white p-3 rounded-full shadow-lg group-hover:scale-110 transition border-4 border-white">
                            <Camera className="w-5 h-5" />
                        </div>
                        <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handlePhotoUpload(e, isDriver ? 'driver' : 'passenger')} />
                    </div>

                    <div className="w-full space-y-6 bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                        <div className="text-center mb-2 text-sm text-gray-400 italic">
                            <Mic className="w-4 h-4 inline mr-1"/> Di "Me llamo [Tu Nombre]" para llenar.
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Nombre Completo</label>
                            <input 
                                type="text" 
                                value={profile.name} 
                                onChange={(e) => isDriver ? setDriverProfile({...driverProfile, name: e.target.value}) : setPassengerProfile({...passengerProfile, name: e.target.value})}
                                className="w-full bg-gray-50 border-2 border-gray-100 focus:border-blue-500 rounded-2xl px-5 py-4 font-semibold text-gray-800 outline-none transition"
                                placeholder="Tu nombre"
                            />
                        </div>
                        
                        <div>
                             <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Teléfono</label>
                             <input 
                                type="tel" 
                                value={profile.phone} 
                                onChange={(e) => isDriver ? setDriverProfile({...driverProfile, phone: e.target.value}) : setPassengerProfile({...passengerProfile, phone: e.target.value})}
                                className="w-full bg-gray-50 border-2 border-gray-100 focus:border-blue-500 rounded-2xl px-5 py-4 font-semibold text-gray-800 outline-none transition"
                                placeholder="300 000 0000"
                             />
                        </div>
                        
                        {isDriver && (
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Placa del Vehículo</label>
                                <input 
                                    type="text" 
                                    value={driverProfile.plate} 
                                    onChange={(e) => setDriverProfile({...driverProfile, plate: e.target.value.toUpperCase()})}
                                    className="w-full bg-gray-50 border-2 border-gray-100 focus:border-emerald-500 rounded-2xl px-5 py-4 font-black text-gray-800 uppercase tracking-widest outline-none transition"
                                    placeholder="XYZ-123"
                                />
                            </div>
                        )}
                    </div>
                    
                    <button 
                        onClick={() => { if(profile.name) setCurrentView(isDriver ? 'driver-dashboard' : 'passenger-dashboard'); else speak("Por favor di tu nombre primero."); }}
                        className={`mt-8 w-full py-5 rounded-2xl text-white font-bold text-lg shadow-xl transform active:scale-95 transition-all ${isDriver ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        Continuar
                    </button>
                </div>
            </div>
         );

      case 'passenger-dashboard':
        return (
           <div className="min-h-screen bg-gray-50 flex flex-col relative overflow-hidden">
               {/* Full Map Background */}
               <div className="absolute inset-0 z-0">
                   <MapComponent lat={userLocation?.lat || 4.57} lng={userLocation?.lng || -74.29} className="w-full h-full" />
                   <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40 pointer-events-none"></div>
               </div>

               {/* Top Bar */}
               <div className="relative z-10 pt-12 px-6 flex justify-between items-start pointer-events-none">
                   <div className="bg-white/90 backdrop-blur-xl p-2 pr-5 rounded-full shadow-lg flex items-center gap-3 pointer-events-auto animate-in slide-in-from-top-4">
                       <div className="w-10 h-10 rounded-full bg-blue-100 overflow-hidden">
                           {passengerProfile.photo ? <img src={passengerProfile.photo} className="w-full h-full object-cover"/> : <User className="w-full h-full p-2 text-blue-500"/>}
                       </div>
                       <div>
                           <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pasajero</p>
                           <p className="font-bold text-gray-800 leading-none">{passengerProfile.name.split(' ')[0]}</p>
                       </div>
                   </div>
                   <button onClick={goBack} className="bg-white/90 p-3 rounded-full shadow-lg text-gray-700 hover:bg-red-50 hover:text-red-500 pointer-events-auto transition"><LogOut className="w-5 h-5"/></button>
               </div>

               {/* Action Card (Bottom Sheet) */}
               <div className="flex-1 flex items-end p-4 pb-32 z-10 pointer-events-none">
                   <div className="w-full bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl p-6 animate-in slide-in-from-bottom-20 duration-500 pointer-events-auto border border-white/50">
                       <h3 className="text-2xl font-black text-slate-800 mb-6">¿A dónde vamos?</h3>
                       
                       <div className="space-y-3">
                           <button onClick={handleGetCurrentLocation} className="w-full flex items-center gap-4 p-4 bg-gray-50/80 hover:bg-blue-50/80 rounded-2xl border border-gray-200/50 transition-colors text-left group">
                               <div className="bg-white p-2.5 rounded-full shadow-sm text-blue-500 group-hover:text-blue-600"><Navigation className="w-5 h-5"/></div>
                               <div className="flex-1 min-w-0">
                                   <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Origen</p>
                                   <p className="font-semibold text-gray-800 truncate">{tripRequest.pickupAddress || (isFetchingLocation ? "Localizando..." : "Mi ubicación")}</p>
                               </div>
                           </button>

                           <button onClick={() => handleSetDestination()} className="w-full flex items-center gap-4 p-4 bg-gray-50/80 hover:bg-emerald-50/80 rounded-2xl border border-gray-200/50 transition-colors text-left group">
                               <div className="bg-white p-2.5 rounded-full shadow-sm text-emerald-500 group-hover:text-emerald-600"><MapPin className="w-5 h-5"/></div>
                               <div className="flex-1 min-w-0">
                                   <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Destino</p>
                                   <p className="font-semibold text-gray-800 truncate">{tripRequest.destinationAddress || "Di un lugar o toca aquí"}</p>
                               </div>
                           </button>
                       </div>

                       {tripRequest.price > 0 && (
                           <div className="mt-6 flex items-center justify-between bg-emerald-50 p-5 rounded-3xl border border-emerald-100/50">
                               <div className="flex flex-col">
                                    <span className="text-emerald-800 font-bold text-sm">Total Estimado</span>
                                    <span className="text-emerald-600 text-xs">{tripRequest.distance.toFixed(1)} km de viaje</span>
                               </div>
                               <span className="text-3xl font-black text-emerald-600">${tripRequest.price.toLocaleString()}</span>
                           </div>
                       )}

                       <button 
                           onClick={requestTrip}
                           disabled={!tripRequest.destinationLat} 
                           className="w-full mt-6 bg-slate-900 hover:bg-black text-white py-5 rounded-2xl font-bold text-xl shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                       >
                           Pedir Mototaxi
                       </button>
                   </div>
               </div>
           </div>
        );

      case 'searching':
        return (
            <div className="min-h-screen bg-blue-600 flex flex-col items-center justify-center p-6 text-white relative overflow-hidden">
                <div className="absolute w-96 h-96 bg-blue-500 rounded-full mix-blend-overlay filter blur-3xl opacity-50 animate-blob"></div>
                <div className="absolute w-96 h-96 bg-indigo-500 rounded-full mix-blend-overlay filter blur-3xl opacity-50 animate-blob animation-delay-2000 bottom-0 right-0"></div>

                <div className="relative z-10 text-center w-full max-w-xs">
                    <div className="w-40 h-40 mx-auto bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center mb-10 relative">
                        <div className="absolute inset-0 border-[6px] border-white/20 rounded-full animate-[ping_2s_linear_infinite]"></div>
                        <div className="absolute inset-0 border-[6px] border-white/10 rounded-full animate-[ping_2s_linear_infinite_1s]"></div>
                        <Bike className="w-20 h-20 text-white animate-bounce drop-shadow-lg" />
                    </div>
                    <h2 className="text-3xl font-black mb-4">Buscando Moto</h2>
                    <p className="text-blue-100 text-lg font-medium mb-12">Contactando conductores cercanos...</p>
                
                    <button onClick={goBack} className="w-full bg-white/20 hover:bg-white/30 backdrop-blur-md px-8 py-4 rounded-2xl font-bold border border-white/30 transition text-white shadow-lg">Cancelar Búsqueda</button>
                </div>
            </div>
        );

      case 'trip-active':
        if (!activeTrip) return null;
        return (
           <div className="min-h-screen bg-gray-100 flex flex-col">
               <div className="flex-1 relative">
                   {/* The Map now handles the visual movement of the bike icon via props update */}
                   <MapComponent 
                      lat={activeTrip.driverLat || activeTrip.pickupLat} 
                      lng={activeTrip.driverLng || activeTrip.pickupLng}
                      destinationLat={activeTrip.destinationLat}
                      destinationLng={activeTrip.destinationLng}
                      iconType="moto"
                      className="w-full h-full"
                   />
                   
                   {/* Floating Status Bubble */}
                   <div className="absolute top-12 left-6 right-6 z-[400] flex justify-center">
                       <div className="bg-slate-900/90 backdrop-blur-md text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 border border-white/20">
                           <div className="flex flex-col items-center">
                               <span className="text-[10px] font-bold text-gray-400 uppercase">Llegada</span>
                               <span className="font-bold text-lg">~5 min</span>
                           </div>
                           <div className="w-px h-8 bg-white/20"></div>
                           <div className="flex flex-col items-center">
                               <span className="text-[10px] font-bold text-gray-400 uppercase">Distancia</span>
                               <span className="font-bold text-lg">{calculateDistance(activeTrip.driverLat!, activeTrip.driverLng!, activeTrip.destinationLat!, activeTrip.destinationLng!).toFixed(1)} km</span>
                           </div>
                       </div>
                   </div>
               </div>

               {/* Driver/Trip Info Sheet */}
               <div className="bg-white rounded-t-[3rem] shadow-[0_-20px_60px_rgba(0,0,0,0.2)] p-8 relative z-[500] -mt-10 animate-in slide-in-from-bottom-full duration-700 pb-32">
                   <div className="w-16 h-1.5 bg-gray-200 rounded-full mx-auto mb-8"></div>
                   
                   <div className="flex items-center gap-6 mb-8">
                       <div className="w-20 h-20 rounded-2xl bg-gray-100 overflow-hidden shadow-lg border-2 border-white">
                           <img src={activeTrip.driverPhoto} className="w-full h-full object-cover" />
                       </div>
                       <div className="flex-1">
                           <h2 className="text-2xl font-black text-slate-900">{activeTrip.driverName}</h2>
                           <div className="flex items-center gap-2 mt-1">
                               <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wide">{activeTrip.driverPlate}</span>
                               <span className="flex items-center text-amber-500 font-bold text-sm"><Star className="w-4 h-4 fill-current mr-1"/> 4.9</span>
                           </div>
                       </div>
                       <button className="w-14 h-14 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-green-500/30 transition-transform hover:scale-105"><Phone className="w-7 h-7"/></button>
                   </div>

                   <div className="space-y-8 relative pl-4 border-l-2 border-dashed border-gray-200 ml-2">
                       <div className="relative">
                           <div className="absolute -left-[23px] top-1 w-5 h-5 rounded-full bg-blue-500 border-4 border-white shadow-sm"></div>
                           <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Punto de Encuentro</p>
                           <p className="text-gray-800 font-bold text-lg leading-none">{activeTrip.pickupAddress.split(',')[0]}</p>
                       </div>
                       <div className="relative">
                           <div className="absolute -left-[23px] top-1 w-5 h-5 rounded-full bg-red-500 border-4 border-white shadow-sm"></div>
                           <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Destino Final</p>
                           <p className="text-gray-800 font-bold text-lg leading-none">{activeTrip.destinationAddress.split(',')[0]}</p>
                       </div>
                   </div>

                   <button onClick={completeTrip} className="w-full mt-10 bg-red-50 hover:bg-red-100 text-red-600 font-bold py-5 rounded-2xl transition border-2 border-red-100">
                       Finalizar Viaje (Simulado)
                   </button>
               </div>
           </div>
        );

      case 'rate-driver':
          return (
              <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 relative">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 animate-pulse"></div>

                  <div className="relative z-10 w-full max-w-md bg-white/10 backdrop-blur-2xl border border-white/20 p-10 rounded-[3rem] shadow-2xl text-center animate-in zoom-in-90 duration-500">
                      <div className="w-28 h-28 mx-auto rounded-full border-4 border-white/30 shadow-2xl overflow-hidden mb-6">
                           <img src={activeTrip?.driverPhoto || 'https://ui-avatars.com/api/?name=Driver'} className="w-full h-full object-cover" />
                      </div>
                      <h2 className="text-3xl font-black text-white mb-2">¡Llegamos!</h2>
                      <p className="text-blue-200 mb-10 text-lg">¿Cómo condujo {activeTrip?.driverName}?</p>

                      <div className="flex justify-center gap-3 mb-10">
                          {[1, 2, 3, 4, 5].map((star) => (
                              <button key={star} onClick={() => submitRating(star)} className="group transition-transform hover:scale-125 focus:outline-none">
                                  <Star className="w-10 h-10 text-amber-400 fill-none group-hover:fill-amber-400 transition-all drop-shadow-lg" />
                              </button>
                          ))}
                      </div>
                      
                      <button onClick={() => submitRating(5)} className="w-full bg-white text-slate-900 font-bold py-4 rounded-xl hover:bg-blue-50 transition">Omitir</button>
                  </div>
              </div>
          );

      case 'driver-dashboard':
          return (
            <div className="min-h-screen bg-gray-100 pb-24">
                <div className="bg-slate-900 p-8 pb-16 rounded-b-[3rem] shadow-2xl text-white relative overflow-hidden">
                    {/* Abstract shapes */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl -mr-16 -mt-16"></div>
                    
                    <div className="flex justify-between items-center mb-8 relative z-10">
                        <div className="flex items-center gap-4">
                             <div className="w-16 h-16 rounded-full border-2 border-emerald-400 p-1">
                                 <div className="w-full h-full rounded-full overflow-hidden bg-slate-800">
                                    {driverProfile.photo ? <img src={driverProfile.photo} className="w-full h-full object-cover"/> : <User className="w-full h-full p-3"/>}
                                 </div>
                             </div>
                             <div>
                                 <h2 className="text-2xl font-bold">{driverProfile.name}</h2>
                                 <div className="flex items-center gap-2">
                                     <div className={`w-2 h-2 rounded-full ${driverStatus === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`}></div>
                                     <span className="text-slate-300 text-sm font-medium">{driverStatus === 'online' ? 'En línea' : 'Desconectado'}</span>
                                 </div>
                             </div>
                        </div>
                        <button onClick={goBack} className="bg-white/10 p-3 rounded-xl hover:bg-white/20 transition"><LogOut className="w-6 h-6 text-white"/></button>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 relative z-10">
                        <div className="bg-white/10 backdrop-blur-md p-5 rounded-3xl border border-white/10">
                            <p className="text-4xl font-black">{driverProfile.completedTrips}</p>
                            <p className="text-emerald-200 text-xs font-bold uppercase tracking-wider mt-1">Viajes Totales</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md p-5 rounded-3xl border border-white/10">
                            <div className="flex items-center gap-2">
                                <p className="text-4xl font-black text-amber-400">{driverProfile.rating}</p>
                                <Star className="w-6 h-6 text-amber-400 fill-current"/>
                            </div>
                            <p className="text-amber-200 text-xs font-bold uppercase tracking-wider mt-1">Calificación</p>
                        </div>
                    </div>
                </div>
                
                <div className="px-6 -mt-8 relative z-20">
                    <button onClick={() => setDriverStatus(s => s === 'online' ? 'offline' : 'online')} className={`w-full py-5 rounded-2xl shadow-xl font-bold text-lg flex items-center justify-center gap-3 transition-all transform active:scale-95 ${driverStatus === 'online' ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white'}`}>
                        {driverStatus === 'online' ? 'Desconectarse' : 'Iniciar Turno'}
                    </button>
                </div>

                <div className="p-6 mt-4">
                    <h3 className="font-bold text-gray-400 uppercase text-sm mb-4 tracking-wider">Solicitudes Recientes</h3>
                    {driverStatus === 'online' ? (
                        trips.length > 0 ? (
                            trips.map(t => (
                                <div key={t.id} className="bg-white p-6 rounded-3xl shadow-lg mb-4 border border-gray-100 animate-in slide-in-from-bottom-4">
                                    <div className="flex justify-between mb-4 items-start">
                                        <h3 className="font-bold text-xl text-gray-800">{t.passengerName}</h3>
                                        <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-black text-sm">${t.price.toLocaleString()}</span>
                                    </div>
                                    <div className="space-y-4 text-sm text-gray-600 mb-6">
                                        <div className="flex gap-3">
                                            <div className="mt-1 min-w-[16px]"><Navigation className="w-4 h-4 text-blue-500"/></div>
                                            <p className="font-medium">{t.pickupAddress}</p>
                                        </div>
                                        <div className="flex gap-3">
                                            <div className="mt-1 min-w-[16px]"><MapPin className="w-4 h-4 text-red-500"/></div>
                                            <p className="font-medium">{t.destinationAddress}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => { setActiveTrip({...t, status: 'accepted', driverLat: userLocation?.lat, driverLng: userLocation?.lng}); setTrips([]); setCurrentView('trip-active'); speak("Viaje aceptado. Dirígete al punto de recogida."); }} className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 rounded-2xl transition shadow-lg">Aceptar Viaje</button>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-12 bg-white rounded-3xl shadow-sm border border-gray-100">
                                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Clock className="w-8 h-8 text-gray-300 animate-pulse"/>
                                </div>
                                <p className="text-gray-400 font-medium">Esperando solicitudes...</p>
                            </div>
                        )
                    ) : (
                        <div className="text-center py-12 opacity-50">
                            <p className="text-gray-400">Conéctate para recibir viajes.</p>
                        </div>
                    )}
                </div>
            </div>
          );

      default: return null;
    }
  };

  return (
    <>
      {renderContent()}
      {renderVoiceIndicator()}
    </>
  );
};

export default App;
