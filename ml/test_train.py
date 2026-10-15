import unittest

from train import choose_thresholds


class ThresholdSelectionTest(unittest.TestCase):
    def test_separates_high_precision_threshold_from_high_recall_threshold(self) -> None:
        review, high = choose_thresholds(
            labels=[0, 0, 1, 1],
            scores=[0.1, 0.5, 0.4, 0.9],
        )

        self.assertEqual(review, 0.4)
        self.assertEqual(high, 0.9)


if __name__ == "__main__":
    unittest.main()
