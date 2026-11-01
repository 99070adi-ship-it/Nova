"""Which AI answers, and how the running server decides that. Guards the real-world failure where the app kept answering in
rule-based demo mode: a stale/different .env, a process environment variable winning, a server started from another directory, a
settings cache that was never reloaded. Also pins that the TEXT AI and the VOICE (text-to-speech) provider are independent.
No network, no key: the SDK is mocked."""

import json
import pathlib


from app.ai import status as ai_status
from app.ai.factory import UnavailableProvider, build_llm_provider
from app.ai.fake_provider import FakeLLMProvider
from app.ai.openai_compatible_provider import OpenAICompatibleProvider
from app.config import ENV_FILE, Settings, get_settings
from tests.test_nvidia_provider import SECRET
from tests.test_preview_publish_baseline import _demo
from tests.test_openai_provider import _completion

BACKEND = pathlib.Path(__file__).resolve().parents[1]


# ---- environment loading ----

def test_the_env_file_is_always_backend_dot_env_whatever_the_working_directory(tmp_path, monkeypatch):
    assert ENV_FILE == BACKEND / ".env"
    monkeypatch.chdir(tmp_path)  # a server launched from somewhere else must still read backend/.env
    assert Settings.model_config["env_file"] == BACKEND / ".env" and pathlib.Path(Settings.model_config["env_file"]).is_absolute()


def test_settings_read_the_text_ai_from_the_env_file(tmp_path, monkeypatch):
    for name in ("AI_PROVIDER", "NVIDIA_MODEL", "NVIDIA_BASE_URL", "NVIDIA_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    f = tmp_path / ".env"
    f.write_text("AI_PROVIDER=nvidia\nNVIDIA_API_KEY=placeholder-not-a-real-key\nNVIDIA_MODEL=nvidia/some-other-model\nNVIDIA_BASE_URL=https://example.test/v1\n")
    s = Settings(_env_file=f)
    assert (s.ai_provider, s.nvidia_model, s.nvidia_base_url) == ("nvidia", "nvidia/some-other-model", "https://example.test/v1")
    assert s.nvidia_api_key == "placeholder-not-a-real-key"


def test_defaults_are_the_fake_provider_and_the_documented_nemotron_model(tmp_path, monkeypatch):
    for name in ("AI_PROVIDER", "NVIDIA_MODEL", "NVIDIA_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    s = Settings(_env_file=tmp_path / "missing.env")
    assert s.ai_provider == "fake" and s.nvidia_model == "nvidia/nemotron-3-super-120b-a12b" and s.nvidia_base_url == "https://integrate.api.nvidia.com/v1"


def test_a_process_environment_variable_beats_the_env_file(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("AI_PROVIDER=fake\n")
    monkeypatch.setenv("AI_PROVIDER", "nvidia")
    assert Settings(_env_file=f).ai_provider == "nvidia"  # so a stale exported variable can also explain "it's still fake"/"it's still nvidia"


def test_there_is_no_hardcoded_text_provider_override_anywhere_in_the_chat_path():
    for rel in ("app/services/agent_service.py", "app/ai/factory.py", "app/api/v1/routes_ai.py"):
        src = (BACKEND / rel).read_text()
        assert "FakeLLMProvider(" not in src.replace("return FakeLLMProvider()", "")  # only the explicit fake branch of the factory
    factory = (BACKEND / "app/ai/factory.py").read_text()
    assert factory.count("return FakeLLMProvider()") == 1  # the one explicit AI_PROVIDER=fake branch


# ---- provider selection ----

def test_provider_selection_follows_ai_provider_and_is_rebuilt_on_every_call(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "fake")
    assert isinstance(build_llm_provider(), FakeLLMProvider)
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", "placeholder")
    nvidia = build_llm_provider()
    assert isinstance(nvidia, OpenAICompatibleProvider) and str(nvidia._client.base_url).startswith("https://integrate.api.nvidia.com/v1")
    monkeypatch.setattr(s, "ai_provider", "fake")
    assert isinstance(build_llm_provider(), FakeLLMProvider)  # nothing cached between calls: the factory reads settings each time
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", None)
    assert isinstance(build_llm_provider(), UnavailableProvider)  # never the fake


async def test_the_chat_endpoint_really_calls_nvidia_with_the_configured_model_when_selected(client, monkeypatch):
    from openai.resources.chat.completions import AsyncCompletions

    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", SECRET)
    monkeypatch.setattr(s, "nvidia_model", "nvidia/nemotron-3-super-120b-a12b")
    seen: list[dict] = []

    async def fake_create(self, **kwargs):
        seen.append({"model": kwargs["model"], "base_url": str(self._client.base_url), "key_sent_as_auth": self._client.api_key == SECRET})
        return _completion(content="Hello from the model.")

    monkeypatch.setattr(AsyncCompletions, "create", fake_create)
    headers, _ = await _demo(client)
    chat = (await client.post("/api/v1/ai/conversations", json={"agent_key": "assistant", "context": {}}, headers=headers)).json()["id"]
    res = await client.post(f"/api/v1/ai/conversations/{chat}/messages", json={"text": "Hey NOVA"}, headers=headers)
    assert res.json()["assistant_text"] == "Hello from the model."
    assert seen == [{"model": "nvidia/nemotron-3-super-120b-a12b", "base_url": "https://integrate.api.nvidia.com/v1/", "key_sent_as_auth": True}]
    assert SECRET not in res.text


# ---- the voice provider is a separate system ----

def test_text_ai_and_voice_do_not_know_about_each_other():
    ai_files = ["app/ai/factory.py", "app/ai/openai_compatible_provider.py", "app/ai/agent_loop.py", "app/services/agent_service.py"]
    for rel in ai_files:
        src = (BACKEND / rel).read_text().lower()
        assert "kokoro" not in src and "import app.ai.speech" not in src and "from app.ai.speech" not in src and "tts_" not in src.replace("tts_provider", "") , rel
    speech = (BACKEND / "app/ai/speech.py").read_text().lower()
    assert "nvidia" not in speech and "openai" not in speech and "nemotron" not in speech


async def test_selecting_the_text_ai_does_not_touch_the_voice_provider(client, monkeypatch):
    from app.ai import speech

    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", "placeholder")
    monkeypatch.setattr(s, "tts_provider", "fake")
    monkeypatch.setattr(speech, "_provider", None)
    build_llm_provider()
    assert speech._provider is None  # building the text AI never builds or loads the voice engine
    headers, _ = await _demo(client)
    body = (await client.get("/api/v1/ai/status", headers=headers)).json()
    assert body["provider"] == "nvidia" and body["voice"] == {"provider": "fake", "role": "speech output only"}
    # Voice still works independently while the text AI is NVIDIA.
    res = await client.post("/api/v1/ai/speech", json={"text": "Hello."}, headers=headers)
    assert res.status_code == 200 and res.headers["content-type"] == "audio/wav"
    monkeypatch.setattr(speech, "_provider", None)


# ---- the status endpoint's account of where the config came from ----

def _file(tmp_path, monkeypatch, text):
    f = tmp_path / ".env"
    f.write_text(text)
    monkeypatch.setattr(ai_status, "ENV_FILE", f)
    return f


def test_status_says_to_restart_when_the_env_file_changed_after_the_server_started(tmp_path, monkeypatch):
    s = get_settings()
    for name in ("AI_PROVIDER", "NVIDIA_API_KEY", "NVIDIA_MODEL", "NVIDIA_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(s, "ai_provider", "fake")
    monkeypatch.setattr(s, "nvidia_api_key", None)
    _file(tmp_path, monkeypatch, "AI_PROVIDER=nvidia\nNVIDIA_API_KEY=placeholder-value\n")
    cfg = ai_status.describe()["config"]
    assert cfg["restart_required"] is True and set(cfg["changed_on_disk"]) == {"AI_PROVIDER", "NVIDIA_API_KEY"}
    _file(tmp_path, monkeypatch, "AI_PROVIDER=fake\n")
    assert ai_status.describe()["config"]["restart_required"] is False


def test_status_names_environment_variables_that_override_the_file_without_revealing_values(tmp_path, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "fake")
    monkeypatch.setenv("AI_PROVIDER", "fake")
    monkeypatch.setenv("NVIDIA_API_KEY", SECRET)
    _file(tmp_path, monkeypatch, "AI_PROVIDER=nvidia\n")
    cfg = ai_status.describe()["config"]
    assert set(cfg["overridden_by_environment"]) >= {"AI_PROVIDER", "NVIDIA_API_KEY"}
    assert cfg["restart_required"] is False  # the environment, not the file, decides: editing the file can't change it
    assert SECRET not in json.dumps(ai_status.describe())


def test_status_never_contains_any_part_of_the_key_even_when_the_file_has_one(tmp_path, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", SECRET)
    _file(tmp_path, monkeypatch, f"AI_PROVIDER=nvidia\nNVIDIA_API_KEY={SECRET}\n")
    blob = json.dumps(ai_status.describe())
    assert "nvapi" not in blob and SECRET[:8] not in blob and SECRET[-6:] not in blob
    info = ai_status.describe()
    assert info["provider"] == "nvidia" and info["model"] == "nvidia/nemotron-3-super-120b-a12b" and info["credentials_configured"] is True and info["real_ai"] is True


def test_status_reports_demo_mode_plainly(monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_provider", "fake")
    info = ai_status.describe()
    assert info["real_ai"] is False and info["mode"] == "rule_based_demo" and info["provider"] == "fake"
