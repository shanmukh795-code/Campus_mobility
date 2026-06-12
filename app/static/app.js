const API_URL = '/api';
let token = localStorage.getItem('token');
let user = null;
let socket = null;
let currentRide = null;
let ratedRideIds = new Set(); // Track rides already rated
let pollInterval = null;

// Map state
let map = null;
let driverMarkers = {};
let pickupMarker = null;
let destMarker = null;
let myLocationMarker = null;
let geoWatchId = null;
let selectedPickup = null;
let selectedDest = null;

const appEl = document.getElementById('app');

// State Management
async function init() {
    if (token) {
        try {
            const res = await fetch(`${API_URL}/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                user = await res.json();
                connectWebSocket();
                renderDashboard();
            } else {
                logout();
            }
        } catch (e) {
            logout();
        }
    } else {
        renderAuth();
    }
}

function logout() {
    token = null;
    user = null;
    localStorage.removeItem('token');
    if (socket) socket.close();
    if (geoWatchId) navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
    if (map) { map.remove(); map = null; }
    driverMarkers = {};
    renderAuth();
}

// WebSockets
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    
    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        console.log("WS Message:", msg);
        
        if (msg.type === 'NEW_RIDE_REQUEST' && user.role === 'driver') {
            // Add to incoming list if driver is online
            const toggle = document.getElementById('driver-online-toggle');
            if (toggle && toggle.checked) {
                renderIncomingRequest(msg.data);
            }
        }
        else if (msg.type === 'RIDE_UPDATED') {
            // Re-fetch full ride data to get the latest state
            if (user.role === 'passenger') {
                await refreshPassengerRide();
            } else if (user.role === 'driver' && currentRide && currentRide.id === msg.data.id) {
                currentRide.status = msg.data.status;
                updateDriverRideUI();
            }
        }
        else if (msg.type === 'DRIVER_LOCATION_UPDATED') {
            if (user.role === 'passenger') {
                loadAvailableDrivers();
                if (map && msg.data.lat && msg.data.lng) {
                    const id = msg.data.driver_id;
                    if (driverMarkers[id]) {
                        driverMarkers[id].setLatLng([msg.data.lat, msg.data.lng]);
                    } else {
                        driverMarkers[id] = L.marker([msg.data.lat, msg.data.lng]).addTo(map).bindPopup("Driver");
                    }
                }
            }
        }
        else if (msg.type === 'DRIVER_STATS_UPDATED') {
            if (user.role === 'driver' && user.id === msg.data.driver_id) {
                loadDriverStats();
            }
        }
    };
}

// Rendering
function renderAuth() {
    const tpl = document.getElementById('tpl-auth').content.cloneNode(true);
    appEl.innerHTML = '';
    appEl.appendChild(tpl);

    let isLogin = true;
    const btnLogin = document.getElementById('btn-show-login');
    const btnRegister = document.getElementById('btn-show-register');
    const regFields = document.getElementById('register-fields');
    const roleSelect = document.getElementById('role');
    const vehicleInput = document.getElementById('vehicle_info');

    btnLogin.onclick = () => { isLogin = true; btnLogin.classList.add('active'); btnRegister.classList.remove('active'); regFields.style.display = 'none'; };
    btnRegister.onclick = () => { isLogin = false; btnRegister.classList.add('active'); btnLogin.classList.remove('active'); regFields.style.display = 'block'; };
    
    roleSelect.onchange = () => {
        vehicleInput.style.display = roleSelect.value === 'driver' ? 'block' : 'none';
    };

    document.getElementById('auth-form').onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('auth-error');
        errorEl.innerText = '';

        try {
            if (isLogin) {
                const formData = new URLSearchParams();
                formData.append('username', email);
                formData.append('password', password);
                
                const res = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData
                });
                if (!res.ok) throw new Error("Login failed");
                const data = await res.json();
                token = data.access_token;
                localStorage.setItem('token', token);
                await init();
            } else {
                const res = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email, password,
                        name: document.getElementById('name').value,
                        role: roleSelect.value,
                        vehicle_info: roleSelect.value === 'driver' ? vehicleInput.value : undefined
                    })
                });
                if (!res.ok) throw new Error("Registration failed");
                isLogin = true;
                btnLogin.click();
                alert("Registration successful. Please login.");
            }
        } catch (err) {
            errorEl.innerText = err.message;
        }
    };
}

async function renderDashboard() {
    if (user.role === 'passenger') {
        const tpl = document.getElementById('tpl-passenger').content.cloneNode(true);
        appEl.innerHTML = '';
        appEl.appendChild(tpl);
        
        document.getElementById('btn-logout').onclick = logout;
        
        document.getElementById('request-ride-form').onsubmit = async (e) => {
            e.preventDefault();
            const pickup = document.getElementById('pickup_addr').value;
            const dest = document.getElementById('dest_addr').value;
            
            const res = await fetch(`${API_URL}/rides`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pickup_lat: selectedPickup ? selectedPickup.lat : 0, 
                    pickup_lng: selectedPickup ? selectedPickup.lng : 0, 
                    pickup_address: pickup,
                    dest_lat: selectedDest ? selectedDest.lat : 0, 
                    dest_lng: selectedDest ? selectedDest.lng : 0, 
                    dest_address: dest
                })
            });
            if (res.ok) {
                currentRide = await res.json();
                updatePassengerRideUI();
                startPassengerPolling();
            }
        };

        const cancelBtn = document.getElementById('btn-cancel-ride');
        if (cancelBtn) {
            cancelBtn.onclick = async () => {
                if(!currentRide) return;
                const res = await fetch(`${API_URL}/rides/${currentRide.id}`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'Cancelled' })
                });
                if(res.ok) {
                    currentRide = await res.json();
                    updatePassengerRideUI();
                    stopPassengerPolling();
                    setTimeout(() => { currentRide = null; updatePassengerRideUI(); }, 2000);
                }
            };
        }

        setupRatingModal();
        await loadAvailableDrivers();
        await loadCurrentRide();
        if (currentRide) startPassengerPolling();
        
        setTimeout(() => initMap('passenger-map', 'passenger'), 100);
    } else {
        // Driver
        const tpl = document.getElementById('tpl-driver').content.cloneNode(true);
        appEl.innerHTML = '';
        appEl.appendChild(tpl);
        
        document.getElementById('btn-logout').onclick = logout;
        
        document.getElementById('driver-online-toggle').onchange = async (e) => {
            const isOnline = e.target.checked;
            const statusText = document.getElementById('driver-status-text');
            statusText.innerText = isOnline ? 'Status: Online' : 'Status: Offline';
            statusText.style.color = isOnline ? 'var(--accent)' : 'var(--text-muted)';
            
            let lat = 0, lng = 0;
            if (myLocationMarker) {
                lat = myLocationMarker.getLatLng().lat;
                lng = myLocationMarker.getLatLng().lng;
            }

            await fetch(`${API_URL}/drivers/availability`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_online: isOnline, current_lat: lat, current_lng: lng })
            });
            if (isOnline) loadIncomingRequests();
            else document.getElementById('incoming-requests-list').innerHTML = `
                <div class="empty-state" style="margin:auto; display:flex; flex-direction:column; align-items:center;">
                    <span style="font-size:3rem; margin-bottom:10px; opacity:0.5;">📭</span>
                    <p>Go online to see requests...</p>
                </div>
            `;
        };
        
        document.getElementById('btn-update-status').onclick = async () => {
            if(!currentRide) return;
            const nextStatus = currentRide.status === 'Accepted' ? 'In Progress' : 'Completed';
            const res = await fetch(`${API_URL}/rides/${currentRide.id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: nextStatus, driver_id: user.id })
            });
            if(res.ok) {
                currentRide = await res.json();
                updateDriverRideUI();
                if (currentRide.status === 'Completed') {
                    await loadDriverStats();
                    setTimeout(() => { currentRide = null; updateDriverRideUI(); }, 2000);
                }
            }
        };

        await loadDriverStats();
        await loadCurrentRide();
        
        setTimeout(() => initMap('driver-map', 'driver'), 100);
    }
}

async function loadCurrentRide() {
    const res = await fetch(`${API_URL}/rides`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        const rides = await res.json();
        // Sort by ID descending so we get the most recent ride
        rides.sort((a, b) => b.id - a.id);
        
        // find active ride
        if (user.role === 'driver') {
            currentRide = rides.find(r => r.driver_id === user.id && r.status !== 'Completed' && r.status !== 'Cancelled');
            updateDriverRideUI();
        } else {
            // Only care about the most recent ride for the passenger
            if (rides.length > 0) {
                const latest = rides[0];
                if (latest.status === 'Completed' && !ratedRideIds.has(latest.id)) {
                    currentRide = latest;
                } else if (latest.status !== 'Completed' && latest.status !== 'Cancelled') {
                    currentRide = latest;
                } else {
                    currentRide = null;
                }
            } else {
                currentRide = null;
            }
            updatePassengerRideUI();
        }
    }
}

async function loadIncomingRequests() {
    const res = await fetch(`${API_URL}/rides`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        const rides = await res.json();
        const requested = rides.filter(r => r.status === 'Requested');
        const listEl = document.getElementById('incoming-requests-list');
        listEl.innerHTML = '';
        if (requested.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state" style="margin:auto; display:flex; flex-direction:column; align-items:center;">
                    <span style="font-size:3rem; margin-bottom:10px; opacity:0.5;">📭</span>
                    <p>No requests yet...</p>
                </div>
            `;
        } else {
            requested.forEach(r => renderIncomingRequest(r));
        }
    }
}

function renderIncomingRequest(req) {
    const listEl = document.getElementById('incoming-requests-list');
    if (listEl.querySelector('.empty-state')) listEl.innerHTML = '';
    
    // Check if already rendered
    if (document.getElementById(`req-${req.id}`)) return;

    const div = document.createElement('div');
    div.className = 'request-item';
    div.id = `req-${req.id}`;
    div.innerHTML = `
        <p><strong>From:</strong> ${req.pickup_address}</p>
        <p><strong>To:</strong> ${req.dest_address}</p>
        <div style="display:flex; gap:10px; margin-top:10px;">
            <button class="primary-btn pulse-anim" onclick="acceptRide(${req.id})" style="flex:1;">Accept</button>
            <button class="secondary-btn" onclick="rejectRide(${req.id})" style="flex:1;">Reject</button>
        </div>
    `;
    listEl.appendChild(div);
}

window.acceptRide = async (id) => {
    if (currentRide && currentRide.driver_id === user.id && currentRide.status !== 'Completed' && currentRide.status !== 'Cancelled') {
        alert("You already have an active ride!");
        return;
    }
    const res = await fetch(`${API_URL}/rides/${id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Accepted', driver_id: user.id })
    });
    if (res.ok) {
        currentRide = await res.json();
        document.getElementById(`req-${id}`).remove();
        updateDriverRideUI();
    } else {
        alert("Ride may have been accepted by someone else or cancelled.");
        document.getElementById(`req-${id}`).remove();
    }
};

window.rejectRide = async (id) => {
    const res = await fetch(`${API_URL}/rides/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (res.ok) {
        document.getElementById(`req-${id}`).remove();
        if(pickupMarker) map.removeLayer(pickupMarker);
        if(destMarker) map.removeLayer(destMarker);
    }
};

function updatePassengerRideUI() {
    const statusEl = document.getElementById('passenger-ride-status');
    const detailsEl = document.getElementById('passenger-ride-details');
    const actionsEl = document.getElementById('passenger-actions');

    if (!statusEl) return; // Guard: passenger template not loaded

    if (!currentRide) {
        statusEl.innerText = 'No active ride';
        statusEl.className = 'status-badge';
        detailsEl.innerHTML = `
            <div class="empty-state" style="margin:auto; display:flex; flex-direction:column; align-items:center;">
                <span style="font-size:3rem; margin-bottom:10px; opacity:0.5;">🚗</span>
                <p>Where to?</p>
            </div>
        `;
        if (actionsEl) actionsEl.style.display = 'none';
        
        // Clear active ride pins if map exists
        if (map) {
            if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
            if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
            selectedPickup = null;
            selectedDest = null;
        }
        return;
    }

    statusEl.innerText = currentRide.status;
    statusEl.className = `status-badge ${currentRide.status.toLowerCase().replace(' ', '-')}`;
    
    detailsEl.innerHTML = `
        <p><strong>Pickup:</strong> ${currentRide.pickup_address}</p>
        <p><strong>Destination:</strong> ${currentRide.dest_address}</p>
    `;
    
    if (currentRide.status === 'Completed') {
        if (actionsEl) actionsEl.style.display = 'none';
        stopPassengerPolling();
        if (!ratedRideIds.has(currentRide.id)) {
            ratedRideIds.add(currentRide.id);
            showRatingModal(currentRide.id);
        }
    } else if (currentRide.status === 'Requested' || currentRide.status === 'Accepted') {
        if (actionsEl) {
            actionsEl.style.display = 'block';
            document.getElementById('btn-cancel-ride').style.display = 'block';
        }
    } else {
        // In Progress - hide cancel
        if (actionsEl) {
            actionsEl.style.display = 'block';
            document.getElementById('btn-cancel-ride').style.display = 'none';
        }
    }
    
    // Draw the active ride on the map
    drawRideOnMap(currentRide);
}

async function refreshPassengerRide() {
    const res = await fetch(`${API_URL}/rides`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        const rides = await res.json();
        rides.sort((a, b) => b.id - a.id); // Newest first
        
        if (rides.length > 0) {
            const latest = rides[0];
            if (latest.status === 'Completed' && !ratedRideIds.has(latest.id)) {
                currentRide = latest;
            } else if (latest.status !== 'Completed' && latest.status !== 'Cancelled') {
                currentRide = latest;
            } else {
                currentRide = null;
            }
        } else {
            currentRide = null;
        }
        updatePassengerRideUI();
    }
}

function startPassengerPolling() {
    stopPassengerPolling();
    pollInterval = setInterval(async () => {
        await refreshPassengerRide();
    }, 3000); // Poll every 3 seconds
}

function stopPassengerPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

async function loadAvailableDrivers() {
    try {
        const res = await fetch(`${API_URL}/drivers/available`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const drivers = await res.json();
            const badge = document.getElementById('available-drivers-badge');
            if (badge) {
                badge.innerText = `${drivers.length} Drivers Online`;
                badge.className = drivers.length > 0 ? 'status-badge completed' : 'status-badge in-progress';
            }
            if (map) {
                drivers.forEach(d => {
                    if (d.current_lat && d.current_lng) {
                        if (driverMarkers[d.id]) {
                            driverMarkers[d.id].setLatLng([d.current_lat, d.current_lng]);
                        } else {
                            driverMarkers[d.id] = L.marker([d.current_lat, d.current_lng]).addTo(map).bindPopup("Driver");
                        }
                    }
                });
            }
        }
    } catch(e) {}
}

async function loadDriverStats() {
    try {
        const res = await fetch(`${API_URL}/drivers/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const stats = await res.json();
            document.getElementById('stat-total-rides').innerText = stats.total_rides;
            document.getElementById('stat-avg-rating').innerText = stats.average_rating.toFixed(1) + ' ★';
            
            const histEl = document.getElementById('driver-history-list');
            if (stats.history.length === 0) {
                histEl.innerHTML = `
                    <div class="empty-state">
                        <span style="font-size:2rem; margin-bottom:10px; opacity:0.5; display:block;">📜</span>
                        <p>No completed rides yet.</p>
                    </div>
                `;
            } else {
                histEl.innerHTML = '';
                stats.history.reverse().forEach(r => {
                    const stars = r.rating_score ? r.rating_score + ' ★' : 'No rating';
                    const feedback = r.rating_feedback ? r.rating_feedback : 'N/A';
                    histEl.innerHTML += `<div class="request-item expandable" onclick="this.classList.toggle('expanded')">
                        <div class="history-header">
                            <span class="history-date"><i class="icon">📅</i> ${r.formatted_time || new Date(r.created_at).toLocaleDateString()}</span>
                            <span class="history-times"><i class="icon">⏱</i> ${r.pickup_time || 'N/A'} - ${r.dropoff_time || 'N/A'}</span>
                        </div>
                        <div class="history-route">
                            <div class="route-point">
                                <span class="route-dot pickup-dot"></span>
                                <span class="route-text">${r.pickup_address}</span>
                            </div>
                            <div class="route-line"></div>
                            <div class="route-point">
                                <span class="route-dot dest-dot"></span>
                                <span class="route-text">${r.dest_address}</span>
                            </div>
                        </div>
                        <div class="expandable-content">
                            <div class="rating-feedback-box">
                                <p class="rating-row"><strong>Rating:</strong> <span class="rating-stars-text">${stars}</span></p>
                                <p class="feedback-row"><strong>Feedback:</strong> <span class="feedback-text">${feedback}</span></p>
                            </div>
                        </div>
                    </div>`;
                });
            }
        }
    } catch(e) {}
}

let activeRatingRideId = null;
function setupRatingModal() {
    const modal = document.getElementById('rating-modal');
    const stars = modal.querySelectorAll('.star');
    let selectedScore = 5;

    stars.forEach(s => {
        s.onclick = () => {
            selectedScore = parseInt(s.dataset.val);
            stars.forEach(st => {
                if(parseInt(st.dataset.val) <= selectedScore) st.classList.add('active');
                else st.classList.remove('active');
            });
        };
    });

    document.getElementById('btn-submit-rating').onclick = async () => {
        if (!activeRatingRideId) return;
        const feedback = document.getElementById('rating-feedback').value;
        await fetch(`${API_URL}/ratings`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ride_id: activeRatingRideId, score: selectedScore, feedback })
        });
        modal.style.display = 'none';
        activeRatingRideId = null;
    };
}

function showRatingModal(rideId) {
    activeRatingRideId = rideId;
    const modal = document.getElementById('rating-modal');
    modal.style.display = 'flex';
    modal.querySelectorAll('.star').forEach(s => s.classList.add('active'));
    document.getElementById('rating-feedback').value = '';
}

function updateDriverRideUI() {
    const statusEl = document.getElementById('driver-ride-status');
    const detailsEl = document.getElementById('driver-ride-details');
    const actionsEl = document.getElementById('driver-actions');
    const btnUpdate = document.getElementById('btn-update-status');

    if (!currentRide) {
        statusEl.innerText = 'No active ride';
        statusEl.className = 'status-badge';
        detailsEl.innerHTML = `
            <div class="empty-state" style="margin:auto; display:flex; flex-direction:column; align-items:center;">
                <span style="font-size:3rem; margin-bottom:10px; opacity:0.5;">🚗</span>
                <p>Ready to drive</p>
            </div>
        `;
        actionsEl.style.display = 'none';
        return;
    }

    statusEl.innerText = currentRide.status;
    statusEl.className = `status-badge ${currentRide.status.toLowerCase().replace(' ', '-')}`;
    
    detailsEl.innerHTML = `
        <p><strong>Pickup:</strong> ${currentRide.pickup_address}</p>
        <p><strong>Destination:</strong> ${currentRide.dest_address}</p>
    `;
    
    actionsEl.style.display = 'block';
    if (currentRide.status === 'Accepted') {
        btnUpdate.innerText = 'Mark In Progress';
    } else if (currentRide.status === 'In Progress') {
        btnUpdate.innerText = 'Mark Completed';
    } else {
        actionsEl.style.display = 'none';
    }
    drawRideOnMap(currentRide);
}

function drawRideOnMap(ride) {
    if (!map) return;
    if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
    
    if (ride && ride.pickup_lat && ride.pickup_lng) {
        pickupMarker = L.marker([ride.pickup_lat, ride.pickup_lng]).addTo(map).bindPopup("Pickup").openPopup();
    }
    if (ride && ride.dest_lat && ride.dest_lng) {
        destMarker = L.marker([ride.dest_lat, ride.dest_lng]).addTo(map).bindPopup("Destination");
        if (ride.pickup_lat) {
            const bounds = L.latLngBounds([ride.pickup_lat, ride.pickup_lng], [ride.dest_lat, ride.dest_lng]);
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
}

function initMap(mapId, role) {
    if (map) { map.remove(); }
    map = L.map(mapId).setView([0, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            map.setView([lat, lng], 15);
            myLocationMarker = L.marker([lat, lng], { title: "My Location" }).addTo(map).bindPopup("You are here");
        });

        if (role === 'driver') {
            geoWatchId = navigator.geolocation.watchPosition(pos => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (myLocationMarker) myLocationMarker.setLatLng([lat, lng]);
                else myLocationMarker = L.marker([lat, lng], { title: "My Location" }).addTo(map).bindPopup("You are here");
                
                const toggle = document.getElementById('driver-online-toggle');
                if (toggle && toggle.checked) {
                    fetch(`${API_URL}/drivers/availability`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ is_online: true, current_lat: lat, current_lng: lng })
                    });
                }
            });
        }
    }

    if (role === 'passenger') {
        map.on('click', function(e) {
            if (!selectedPickup) {
                selectedPickup = e.latlng;
                if(pickupMarker) map.removeLayer(pickupMarker);
                pickupMarker = L.marker(selectedPickup).addTo(map).bindPopup("Pickup").openPopup();
                document.getElementById('pickup_addr').value = `Lat: ${selectedPickup.lat.toFixed(4)}, Lng: ${selectedPickup.lng.toFixed(4)}`;
            } else if (!selectedDest) {
                selectedDest = e.latlng;
                if(destMarker) map.removeLayer(destMarker);
                destMarker = L.marker(selectedDest).addTo(map).bindPopup("Destination").openPopup();
                document.getElementById('dest_addr').value = `Lat: ${selectedDest.lat.toFixed(4)}, Lng: ${selectedDest.lng.toFixed(4)}`;
                const bounds = L.latLngBounds(selectedPickup, selectedDest);
                map.fitBounds(bounds, { padding: [50, 50] });
            } else {
                selectedPickup = e.latlng;
                selectedDest = null;
                if(pickupMarker) map.removeLayer(pickupMarker);
                if(destMarker) map.removeLayer(destMarker);
                pickupMarker = L.marker(selectedPickup).addTo(map).bindPopup("Pickup").openPopup();
                document.getElementById('pickup_addr').value = `Lat: ${selectedPickup.lat.toFixed(4)}, Lng: ${selectedPickup.lng.toFixed(4)}`;
                document.getElementById('dest_addr').value = "";
            }
        });
    }
    
    // Draw current ride if one exists
    if (currentRide) {
        setTimeout(() => drawRideOnMap(currentRide), 500);
    }
}

// Boot
init();
