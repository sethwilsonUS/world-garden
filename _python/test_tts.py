import unittest

from _python.tts import _normalize_tts_text


class NormalizeTtsTextTests(unittest.TestCase):
    def test_rejects_whitespace_only_text(self):
        self.assertEqual(_normalize_tts_text("  \n\t  "), "")

    def test_preserves_valid_short_text(self):
        self.assertEqual(_normalize_tts_text(" A "), "A")

    def test_rejects_non_string_values(self):
        self.assertEqual(_normalize_tts_text(1), "")


if __name__ == "__main__":
    unittest.main()
