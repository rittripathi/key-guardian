import streamlit as st
import requests
import json

# Page Config
st.set_page_config(page_title="KeyShort Dashboard", page_icon="🔑", layout="wide")

# Sidebar Configuration
st.sidebar.title("🔑 KeyShort")
BACKEND_URL = st.sidebar.text_input("Backend API Base URL", value="http://localhost:8000")

# Session state for JWT/Auth Token
if "token" not in st.session_state:
    st.session_state["token"] = None

def get_headers():
    headers = {"Content-Type": "application/json"}
    if st.session_state["token"]:
        headers["Authorization"] = f"Bearer {st.session_state['token']}"
    return headers

# Navigation Menu
menu = ["Login / Register", "Key Vault", "Test Proxy Endpoint"]
choice = st.sidebar.radio("Navigation", menu)

# -------------------------------------------------------------
# 1. AUTHENTICATION TAB
# -------------------------------------------------------------
if choice == "Login / Register":
    st.title("Welcome to KeyShort")
    st.subheader("Manage your API key aliases securely")
    
    tab_login, tab_reg = st.tabs(["🔐 Login", "📝 Register"])
    
    with tab_login:
        email = st.text_input("Email", key="login_email")
        password = st.text_input("Password", type="password", key="login_pass")
        
        if st.button("Sign In", type="primary"):
            try:
                response = requests.post(
                    f"{BACKEND_URL}/auth/login", 
                    json={"email": email, "password": password}
                )
                if response.status_code == 200:
                    token = response.json().get("access_token")
                    st.session_state["token"] = token
                    st.success("Successfully logged in!")
                    st.balloons()
                else:
                    st.error(f"Login failed: {response.json().get('detail', response.text)}")
            except Exception as e:
                st.error(f"Could not connect to FastAPI backend: {e}")

    with tab_reg:
        reg_email = st.text_input("Email", key="reg_email")
        reg_password = st.text_input("Password", type="password", key="reg_pass")
        
        if st.button("Create Account"):
            try:
                response = requests.post(
                    f"{BACKEND_URL}/auth/register", 
                    json={"email": reg_email, "password": reg_password}
                )
                if response.status_code in (200, 201):
                    st.success("Account created successfully! You can now log in.")
                else:
                    st.error(f"Registration failed: {response.json().get('detail', response.text)}")
            except Exception as e:
                st.error(f"Could not connect to FastAPI backend: {e}")

# -------------------------------------------------------------
# 2. KEY VAULT TAB
# -------------------------------------------------------------
elif choice == "Key Vault":
    st.title("🔑 API Key Vault")
    
    if not st.session_state["token"]:
        st.warning("⚠️ Please sign in under the 'Login / Register' menu first.")
    else:
        # Create New Key Section
        with st.expander("➕ Create New API Key Alias", expanded=False):
            with st.form("add_key_form"):
                label = st.text_input("Label", placeholder="e.g. OpenAI Production")
                secret = st.text_input("Real API Secret Key", type="password", placeholder="sk-...")
                provider = st.selectbox("Provider", ["openai", "anthropic", "custom"])
                provider_url = st.text_input("Base URL", value="https://api.openai.com")
                spend_cap = st.number_input("Monthly Spend Cap ($ USD)", min_value=1.0, value=10.0)
                rate_limit = st.number_input("Rate Limit (Requests/Min)", min_value=1, value=60)
                
                submitted = st.form_submit_button("Generate Alias", type="primary")
                if submitted:
                    payload = {
                        "label": label,
                        "secret": secret,
                        "provider": provider,
                        "provider_base_url": provider_url,
                        "spend_cap": spend_cap,
                        "rate_limit": rate_limit
                    }
                    res = requests.post(f"{BACKEND_URL}/keys", json=payload, headers=get_headers())
                    if res.status_code in (200, 201):
                        data = res.json()
                        st.success(f"Alias `{data.get('alias')}` created successfully!")
                        st.rerun()
                    else:
                        st.error(f"Error creating key: {res.text}")

        # List Existing Keys
        st.subheader("Active Aliases")
        res = requests.get(f"{BACKEND_URL}/keys", headers=get_headers())
        
        if res.status_code == 200:
            keys = res.json()
            if not keys:
                st.info("No API key aliases created yet. Click above to create one.")
            else:
                for k in keys:
                    with st.card() if hasattr(st, "card") else st.container():
                        c1, c2, c3, c4 = st.columns([2, 2, 2, 1])
                        c1.markdown(f"**Alias:** `{k.get('alias')}`\n\n*{k.get('label')}*")
                        c2.markdown(f"**Provider:** {k.get('provider').upper()}")
                        
                        status = "🟢 Active" if k.get('active') else "🔴 Revoked"
                        c3.markdown(f"**Status:** {status}")
                        
                        if k.get('active'):
                            if c4.button("Revoke", key=f"revoke_{k.get('alias')}"):
                                requests.delete(f"{BACKEND_URL}/keys/{k.get('alias')}", headers=get_headers())
                                st.rerun()
                        st.divider()
        else:
            st.error("Failed to fetch keys from backend.")

# -------------------------------------------------------------
# 3. TEST PROXY ENDPOINT
# -------------------------------------------------------------
elif choice == "Test Proxy Endpoint":
    st.title("⚡ Test Streamed Request")
    st.markdown("Test an API request through your local proxy without writing external client code.")
    
    alias_input = st.text_input("Alias Key Name", value="key1", help="The generated short alias name")
    prompt_input = st.text_area("Prompt", "Write a haiku about fast API proxies.")
    
    if st.button("Send Request Through Proxy", type="primary"):
        if not alias_input:
            st.error("Please enter an alias name.")
        else:
            url = f"{BACKEND_URL}/proxy/{alias_input}/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {alias_input}",
                "Content-Type": "application/json"
            }
            body = {
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": prompt_input}],
                "stream": True
            }
            
            st.markdown("### Streamed Response:")
            response_container = st.empty()
            full_text = ""
            
            try:
                # Streaming response handling
                with requests.post(url, json=body, headers=headers, stream=True) as r:
                    if r.status_code == 200:
                        for chunk in r.iter_content(chunk_size=1024):
                            if chunk:
                                text_chunk = chunk.decode("utf-8", errors="ignore")
                                full_text += text_chunk
                                response_container.markdown(full_text)
                    else:
                        st.error(f"Proxy returned Error HTTP {r.status_code}: {r.text}")
            except Exception as e:
                st.error(f"Failed to connect to proxy route: {e}")