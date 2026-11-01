from app.ai.agents import ASSISTANT_SYSTEM_PROMPT, NOVA_GUIDE_SYSTEM_PROMPT, STORE_MANAGER_SYSTEM_PROMPT
from app.ai.assistant_fake import _IDENTITY


def test_every_merchant_facing_prompt_says_aditya_created_nova_and_nvidia_only_provides_the_api():
    for prompt in (ASSISTANT_SYSTEM_PROMPT, NOVA_GUIDE_SYSTEM_PROMPT, STORE_MANAGER_SYSTEM_PROMPT):
        assert "created by Aditya" in prompt
        assert "NVIDIA did not build or create NOVA" in prompt


def test_the_offline_double_gives_the_same_answer():
    assert "Aditya" in _IDENTITY and "NVIDIA's API" in _IDENTITY
