import streamlit as st
import json
import os
import tempfile
from core.schemas import validate_dynamic_payload, SCHEMA_TEMPLATES, MOCK_PAYLOADS
from core.langgraph_engine import run_langgraph_self_healing_agent
from core.executor import execute_patch
from server.registry import save_patch, get_patch, clear_catalog, load_catalog
from core.batch_engine import (
    generate_sample_legacy_csv,
    inspect_legacy_file,
    execute_daft_modernization,
    query_parquet_lake
)

st.set_page_config(
    page_title="Project Resilient - Universal AI Data Operations Platform",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.markdown("""
<style>
    .main-header {
        font-size: 2.2rem;
        font-weight: 700;
        color: #4F46E5;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 1.0rem;
        color: #9CA3AF;
        margin-bottom: 1.5rem;
    }
    .alert-card-red {
        background-color: #371B1E;
        border-left: 5px solid #EF4444;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
    }
    .alert-card-green {
        background-color: #112A22;
        border-left: 5px solid #10B981;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
    }
    .metric-card {
        background-color: #1E1E2E;
        border: 1px solid #313244;
        padding: 1rem;
        border-radius: 10px;
        text-align: center;
    }
    .metric-value {
        font-size: 1.8rem;
        font-weight: 700;
        color: #10B981;
    }
    .metric-label {
        font-size: 0.85rem;
        color: #9CA3AF;
    }
    .ops-badge {
        background-color: #1E1B4B;
        color: #818CF8;
        padding: 0.3rem 0.8rem;
        border-radius: 20px;
        font-size: 0.85rem;
        font-weight: 600;
    }
</style>
""", unsafe_allow_html=True)

# Header
st.markdown('<div class="main-header">⚡ Project Resilient — Universal AI Data Operations Engine</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">Real-Time Ingestion Self-Healing • Daft Multimodal Modernization • DuckDB Parquet Analytics</div>', unsafe_allow_html=True)

# Navigation Tabs
tab_realtime, tab_batch = st.tabs([
    "📡 Real-Time Webhook Pipeline & Auto-Healing",
    "⚡ Mass Legacy Data Modernizer (Daft Framework + DuckDB)"
])

# Sidebar Controls
st.sidebar.title("🛠️ Platform Settings")
st.sidebar.markdown("🗄️ **Database:** SQLite (`resilient.db`)")
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    st.sidebar.markdown("🧠 **AI Engine:** Gemini 2.5 Flash (Live)")
else:
    st.sidebar.markdown("🧠 **AI Engine:** Offline Fallback Engine")

st.sidebar.markdown("---")
if st.sidebar.button("🗑️ Reset Patch Catalog"):
    clear_catalog()
    st.sidebar.success("Catalog cleared!")
    st.rerun()

# =====================================================================
# TAB 1: REAL-TIME WEBHOOK PIPELINE & AUTO-HEALING
# =====================================================================
with tab_realtime:
    st.subheader("🛠️ Dynamic Schema Studio & Live Ingestion")
    
    col_config1, col_config2 = st.columns([1, 1])
    
    with col_config1:
        template_choice = st.selectbox(
            "Select Industry Contract Template:",
            options=list(SCHEMA_TEMPLATES.keys()) + ["➕ Custom User-Defined JSON Schema"]
        )

        if template_choice == "➕ Custom User-Defined JSON Schema":
            custom_schema_name = st.text_input("Schema Contract Name:", value="MyCustomContract")
            custom_fields_text = st.text_area(
                "JSON Field Specs (field: type):",
                value=json.dumps({
                    "tracking_id": "str",
                    "quantity": "int",
                    "amount_usd": "float",
                    "status": "str"
                }, indent=2),
                height=150
            )
            try:
                active_field_specs = json.loads(custom_fields_text)
                active_schema_name = custom_schema_name
            except Exception:
                st.error("Invalid JSON field specs.")
                active_field_specs = SCHEMA_TEMPLATES["Logistics & Supply Chain (LogisticsShipment)"]["fields"]
                active_schema_name = "LogisticsShipment"
        else:
            selected_template = SCHEMA_TEMPLATES[template_choice]
            active_schema_name = selected_template["schema_name"]
            active_field_specs = selected_template["fields"]

    with col_config2:
        selected_feed_key = st.selectbox(
            "Select Mock Vendor Data Feed:",
            options=list(MOCK_PAYLOADS.keys()),
            format_func=lambda x: x.replace("_", " ").title()
        )
        raw_payload = MOCK_PAYLOADS[selected_feed_key]

    st.markdown("---")
    
    # Ingestion & Auto-Healing Layout
    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("📥 Incoming Raw Vendor Payload")
        st.json(raw_payload)

    # Check if an approved patch already exists in catalog
    existing_patch = get_patch(selected_feed_key)

    if existing_patch:
        st.markdown('<div class="alert-card-green">🟢 <b>ACTIVE PATCH IN EFFECT:</b> Data feed is being auto-transformed via saved registry patch. Uptime 100%.</div>', unsafe_allow_html=True)
        success, transformed_dict, logs = execute_patch(existing_patch, raw_payload, active_field_specs, active_schema_name)
        
        with col2:
            st.subheader("✅ Clean Target Stream (Delivered to Client)")
            if success and transformed_dict:
                st.json(transformed_dict)
                st.success(f"Dynamic Schema Contract '{active_schema_name}' Verified!")
            else:
                st.error(f"Active patch execution error: {logs}")

    else:
        is_valid, val_msg, valid_data = validate_dynamic_payload(raw_payload, active_field_specs, model_name=active_schema_name)

        with col2:
            st.subheader("🎯 Dynamic Contract Validation")

            if is_valid and valid_data:
                st.markdown('<div class="alert-card-green">🟢 <b>VALID PAYLOAD:</b> Incoming data matches target JSON schema perfectly. No AI intervention required.</div>', unsafe_allow_html=True)
                st.json(valid_data)
            else:
                st.markdown('<div class="alert-card-red">🚨 <b>SCHEMA DRIFT DETECTED:</b> Vendor API layout changed! Pipeline stopped to prevent data corruption.</div>', unsafe_allow_html=True)
                st.error(f"Schema Validation Failure:\n{val_msg}")

                st.markdown("---")
                st.subheader("🤖 AI Infrastructure Mechanic Action")

                if "generated_patch" not in st.session_state or st.session_state.get("feed_key") != selected_feed_key:
                    st.session_state.generated_patch = None
                    st.session_state.patch_result = None
                    st.session_state.feed_key = selected_feed_key

                if st.button("⚡ Generate & Verify AI Self-Healing Patch"):
                    with st.spinner(f"AI Agent analyzing schema drift against target '{active_schema_name}'..."):
                        success, patch_code, logs = run_langgraph_self_healing_agent(
                            broken_payload=raw_payload,
                            field_specs=active_field_specs,
                            schema_name=active_schema_name,
                            validation_error=val_msg
                        )
                        st.session_state.generated_patch = patch_code
                        st.session_state.patch_result = (success, logs)

                if st.session_state.generated_patch:
                    st.markdown("#### 📝 AI Generated Transformation Patch (Python)")
                    st.code(st.session_state.generated_patch, language="python")

                    patch_success, patch_logs = st.session_state.patch_result

                    st.markdown("#### 🎯 Verification Result")
                    if patch_success:
                        st.success(patch_logs)
                        _, preview_data, _ = execute_patch(st.session_state.generated_patch, raw_payload, active_field_specs, active_schema_name)
                        if preview_data:
                            st.json(preview_data)

                        st.markdown("---")
                        st.markdown('<span class="ops-badge">INTERNAL OPS ACTION</span>', unsafe_allow_html=True)
                        st.write("Clicking approve will save this patch into the active SQL catalog. The client feed instantly heals with 0 client engineering effort.")

                        if st.button("🟢 Approve & Deploy Patch (Zero-Touch Uptime)", type="primary"):
                            save_patch(selected_feed_key, st.session_state.generated_patch)
                            st.balloons()
                            st.success("Patch successfully registered & deployed to production pipeline!")
                            st.rerun()
                    else:
                        st.error(patch_logs)


# =====================================================================
# TAB 2: MASS LEGACY DATA MODERNIZER (DAFT FRAMEWORK + DUCKDB)
# =====================================================================
with tab_batch:
    st.subheader("⚡ Automated Mass Legacy Data Modernization Engine")
    st.markdown("Process 50,000+ rows of messy legacy CSV files using **Daft (Multimodal AI Dataframe Engine)** and **DuckDB Parquet Analytics**.")

    col_batch1, col_batch2 = st.columns([1, 1])

    with col_batch1:
        st.markdown("#### 1. Generate or Load Legacy Dataset")
        row_count_selection = st.slider("Select Benchmark Row Count:", min_value=10000, max_value=200000, value=50000, step=10000)
        
        sample_csv_path = f"/tmp/resilient_legacy_{row_count_selection}.csv"
        sample_parquet_path = f"/tmp/resilient_modernized_{row_count_selection}.parquet"

        if st.button("🎲 Generate Messy Legacy CSV Dataset"):
            with st.spinner(f"Generating {row_count_selection:,} row messy legacy CSV..."):
                generate_sample_legacy_csv(sample_csv_path, num_rows=row_count_selection)
                st.success(f"Generated {row_count_selection:,} row CSV at `{sample_csv_path}`")

    with col_batch2:
        st.markdown("#### 2. Inspect File Properties")
        if os.path.exists(sample_csv_path):
            file_info = inspect_legacy_file(sample_csv_path)
            st.write(f"📁 **File Path:** `{file_info['file_path']}`")
            st.write(f"📊 **Row Count:** `{file_info['total_rows']:,}` rows")
            st.write(f"💾 **Original Size:** `{file_info['file_size_mb']} MB`")
            st.markdown("**Detected Legacy Headers:**")
            st.code(", ".join(file_info['columns']), language="text")
        else:
            st.info("Click 'Generate Messy Legacy CSV Dataset' to begin.")

    st.markdown("---")

    if os.path.exists(sample_csv_path):
        st.markdown("#### 3. Execute Daft Batch Modernization Engine")
        
        if st.button("🚀 Execute Daft Batch Modernization Engine", type="primary"):
            with st.spinner("Daft Multimodal Engine executing transformation & writing snappy Parquet..."):
                batch_stats = execute_daft_modernization(sample_csv_path, sample_parquet_path)
                st.session_state["batch_stats"] = batch_stats
                st.success(f"Modernization & Parquet Compression Complete! (Engine: {batch_stats['engine']})")

        if "batch_stats" in st.session_state:
            stats = st.session_state["batch_stats"]
            
            # Display Metric Cards
            m1, m2, m3, m4 = st.columns(4)
            with m1:
                st.markdown(f'<div class="metric-card"><div class="metric-value">{stats["total_rows_processed"]:,}</div><div class="metric-label">Rows Processed</div></div>', unsafe_allow_html=True)
            with m2:
                st.markdown(f'<div class="metric-card"><div class="metric-value">{stats["elapsed_seconds"]}s</div><div class="metric-label">Processing Time</div></div>', unsafe_allow_html=True)
            with m3:
                st.markdown(f'<div class="metric-card"><div class="metric-value">{stats["rows_per_second"]:,}</div><div class="metric-label">Rows / Second</div></div>', unsafe_allow_html=True)
            with m4:
                st.markdown(f'<div class="metric-card"><div class="metric-value">{stats["storage_saved_pct"]}%</div><div class="metric-label">Storage Saved (Snappy Parquet)</div></div>', unsafe_allow_html=True)

            st.markdown("---")
            st.markdown("#### 4. Instant DuckDB Parquet Analytics Console")
            st.write("Run microsecond SQL queries directly over the compressed Parquet Data Lake:")

            default_sql = "SELECT carrier_name, COUNT(*) as total_shipments, round(AVG(weight_kg), 1) as avg_weight_kg FROM parquet_table GROUP BY carrier_name ORDER BY total_shipments DESC"
            user_sql = st.text_area("DuckDB SQL Query:", value=default_sql, height=80)

            if st.button("🔍 Execute DuckDB Query"):
                with st.spinner("Running DuckDB query over Parquet file..."):
                    query_res = query_parquet_lake(sample_parquet_path, user_sql)
                    if query_res["status"] == "SUCCESS":
                        st.success(f"Query executed in **{query_res['execution_time_ms']} ms** across {query_res['row_count']} result groups!")
                        st.dataframe(query_res["results"])
                    else:
                        st.error("Query failed.")
