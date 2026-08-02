import pytest
from server.registry import save_patch, get_patch, get_patch_version, load_catalog, clear_catalog

def test_save_and_get_patch_scoped_to_client():
    """Verifies that patches are isolated per client — Client A's patch doesn't leak to Client B."""
    save_patch("maersk_v2", "def transform(raw): return raw", client_id="client_a")
    save_patch("maersk_v2", "def transform(raw): return {'modified': True}", client_id="client_b")

    patch_a = get_patch("maersk_v2", client_id="client_a")
    patch_b = get_patch("maersk_v2", client_id="client_b")

    assert patch_a is not None
    assert patch_b is not None
    assert "modified" not in patch_a
    assert "modified" in patch_b

def test_patch_version_auto_increments():
    """Verifies that saving a patch increments the version number."""
    v1 = save_patch("feed_x", "def transform(raw): return raw", client_id="client_v")
    assert v1 == 1

    v2 = save_patch("feed_x", "def transform(raw): return {'v2': True}", client_id="client_v")
    assert v2 == 2

    v3 = save_patch("feed_x", "def transform(raw): return {'v3': True}", client_id="client_v")
    assert v3 == 3

def test_get_patch_version():
    """Verifies patch version retrieval for lineage tracking."""
    save_patch("feed_lineage", "code_v1", client_id="client_l")
    assert get_patch_version("feed_lineage", client_id="client_l") == 1

    save_patch("feed_lineage", "code_v2", client_id="client_l")
    assert get_patch_version("feed_lineage", client_id="client_l") == 2

def test_load_catalog_scoped():
    """load_catalog returns only patches for the requested client."""
    save_patch("feed_1", "code_1", client_id="client_x")
    save_patch("feed_2", "code_2", client_id="client_x")
    save_patch("feed_3", "code_3", client_id="client_y")

    catalog_x = load_catalog(client_id="client_x")
    catalog_y = load_catalog(client_id="client_y")

    assert len(catalog_x) == 2
    assert len(catalog_y) == 1
    assert "feed_3" in catalog_y
    assert "feed_3" not in catalog_x

def test_clear_catalog_scoped():
    """clear_catalog with client_id only clears that client's patches."""
    save_patch("f1", "c1", client_id="keep_me")
    save_patch("f2", "c2", client_id="delete_me")

    clear_catalog(client_id="delete_me")

    assert get_patch("f1", client_id="keep_me") is not None
    assert get_patch("f2", client_id="delete_me") is None

def test_get_nonexistent_patch_returns_none():
    assert get_patch("nonexistent_feed") is None
    assert get_patch_version("nonexistent_feed") is None
