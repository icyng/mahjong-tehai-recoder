from transformers import AutoModelForCausalLM, AutoTokenizer
from mj.models.tehai.myyolo import MYYOLO
 
model_name = "openai/gpt-oss-20b"

_, tiles = MYYOLO(
    model_path='best.pt',
    image_path='agari.png',)
 
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype="auto",
    device_map="mps"
)
 
messages = [
    {"role": "user", "content": f"麻雀において最短で和了を目指す場合、手牌 {tiles} のうちどれを切ればよいでしょうか？"},
]

inputs = tokenizer.apply_chat_template(
    messages,
    add_generation_prompt=True,
    return_tensors="pt",
    return_dict=True,
).to(model.device)
 
outputs = model.generate(
    **inputs,
    max_new_tokens=200,
    temperature=0.8
)
 
print(tokenizer.decode(outputs[0]))