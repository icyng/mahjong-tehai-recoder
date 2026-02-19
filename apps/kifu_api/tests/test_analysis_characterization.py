from __future__ import annotations

import unittest

from apps.kifu_api.app.main import analyze_hand_api, analyze_tenpai


class AnalyzeApiCharacterizationTest(unittest.TestCase):
    def test_analyze_hand_closed_ron_tanyao_shape_is_stable(self) -> None:
        payload = {
            "hand": [
                "2m",
                "3m",
                "4m",
                "2p",
                "3p",
                "4p",
                "3s",
                "4s",
                "5s",
                "6s",
                "7s",
                "8s",
                "5p",
            ],
            "melds": [],
            "winTile": "5p",
            "winType": "ron",
            "isClosed": True,
            "riichi": False,
            "ippatsu": False,
            "roundWind": "E",
            "seatWind": "E",
            "doraIndicators": [],
            "uraDoraIndicators": [],
            "honba": 0,
            "riichiSticks": 0,
            "dealer": False,
        }

        result = analyze_hand_api(payload)

        self.assertTrue(result["ok"])
        self.assertEqual(result["result"]["han"], 1)
        self.assertEqual(result["result"]["fu"], 40)
        self.assertEqual(result["result"]["cost"]["main"], 2000)
        self.assertEqual(result["result"]["yaku"], ["Tanyao"])

    def test_analyze_tenpai_red_five_is_normalized(self) -> None:
        payload = {
            "hand": ["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "E", "E", "E", "0m"]
        }

        result = analyze_tenpai(payload)

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "tenpai")
        self.assertEqual(result["shanten"], 0)
        self.assertEqual(result["waits"], ["5m"])


if __name__ == "__main__":
    unittest.main()
