"""eval/scoring.py 단위 테스트 — 순수 함수라 에이전트/네트워크 없이 돌아간다.

실행:  python -m unittest eval.test_scoring   (backend/ai-server 에서)
"""
import unittest

from eval.scoring import score_turn, summarize


def _tc(tool, **args):
    return {"tool": tool, "tool_input": args, "observation": None}


class ScoreTurnTest(unittest.TestCase):
    def test_specific_tool_match(self):
        s = score_turn(
            {"expect_tool": "search_courses", "expect_args": {"keyword": "데이터베이스"}},
            [_tc("search_courses", keyword="데이터베이스 관련")],
            "데이터베이스설계와질의 등이 있습니다.",
        )
        self.assertTrue(s["tool_selection"])
        self.assertTrue(s["param_match"])
        self.assertEqual(s["unexpected_tools"], [])

    def test_specific_tool_mismatch(self):
        s = score_turn(
            {"expect_tool": "get_course_by_code", "expect_args": {"code": "CS301"}},
            [_tc("search_courses", keyword="CS301")],
            "…",
        )
        self.assertFalse(s["tool_selection"])
        # 기대 Tool을 안 불렀으니 파라미터는 평가 불가
        self.assertIsNone(s["param_match"])
        self.assertEqual(s["unexpected_tools"], ["search_courses"])

    def test_param_whitespace_folding(self):
        s = score_turn(
            {"expect_tool": "get_course_by_code", "expect_args": {"code": "21003735-1"}},
            [_tc("get_course_by_code", code="  21003735-1 ")],
            "…",
        )
        self.assertTrue(s["param_match"])

    def test_param_mismatch(self):
        s = score_turn(
            {"expect_tool": "search_courses", "expect_args": {"keyword": "알고리즘"}},
            [_tc("search_courses", keyword="자료구조")],
            "…",
        )
        self.assertTrue(s["tool_selection"])
        self.assertFalse(s["param_match"])

    def test_none_expected_no_call_passes(self):
        s = score_turn({"expect_tool": "none"}, [], "화면에서 직접 신청하세요.")
        self.assertTrue(s["tool_selection"])
        self.assertFalse(s["over_call"])
        self.assertIsNone(s["under_call"])

    def test_none_expected_with_call_is_over_call(self):
        s = score_turn({"expect_tool": "none"}, [_tc("search_courses", keyword="x")], "…")
        self.assertFalse(s["tool_selection"])
        self.assertTrue(s["over_call"])

    def test_any_expected(self):
        ok = score_turn({"expect_tool": "any"}, [_tc("get_course_by_code", code="x")], "…")
        self.assertTrue(ok["tool_selection"])
        self.assertFalse(ok["under_call"])
        bad = score_turn({"expect_tool": "any"}, [], "지어낸 답")
        self.assertFalse(bad["tool_selection"])
        self.assertTrue(bad["under_call"])

    def test_ignore_not_scored(self):
        s = score_turn({"expect_tool": "ignore", "answer_must_include": ["안태훈"]}, [], "안태훈 교수님입니다.")
        self.assertIsNone(s["tool_selection"])
        self.assertTrue(s["answer_include"])

    def test_ignore_tool_recall_is_not_unexpected(self):
        # 멀티턴 후속에서 모델이 정당하게 Tool을 다시 불러도 unexpected로 잡지 않는다
        s = score_turn({"expect_tool": "ignore"}, [_tc("search_courses", keyword="알고리즘")], "…")
        self.assertEqual(s["unexpected_tools"], [])

    def test_answer_exclude(self):
        s = score_turn(
            {"expect_tool": "any", "answer_must_not_include": ["CS999"]},
            [_tc("search_courses", keyword="x")],
            "그런 과목 CS999 는 개설돼 있습니다.",
        )
        self.assertFalse(s["answer_exclude"])

    def test_unknown_expect_tool_raises(self):
        with self.assertRaises(ValueError):
            score_turn({"expect_tool": "nonsense"}, [], "…")


def _turn(rep, sid, cat, expect, calls, answer="…", latency=100.0, error=None):
    from eval.scoring import score_turn as st
    row = {
        "rep": rep, "scenario_id": sid, "category": cat, "turn_index": 0,
        "user": "q", "answer": answer, "latency_ms": latency,
        "tokens": {"input": 10, "output": 5, "total": 15}, "error": error,
        "scores": st(expect, calls, answer),
    }
    return row


class SummarizeTest(unittest.TestCase):
    def test_sd_and_category_breakdown(self):
        rows = []
        # search-01: rep1 통과, rep2 실패  → flaky
        rows.append(_turn(1, "search-01", "과목검색", {"expect_tool": "search_courses"}, [_tc("search_courses")]))
        rows.append(_turn(2, "search-01", "과목검색", {"expect_tool": "search_courses"}, []))
        # code-01: 두 rep 다 통과 → fully stable
        rows.append(_turn(1, "code-01", "코드조회", {"expect_tool": "get_course_by_code"}, [_tc("get_course_by_code")]))
        rows.append(_turn(2, "code-01", "코드조회", {"expect_tool": "get_course_by_code"}, [_tc("get_course_by_code")]))

        summary = summarize(rows, n_reps=2, meta={"model": "test"})
        self.assertEqual(summary["n_scenarios"], 2)
        # rep1 정확도 1.0, rep2 정확도 0.5 → sd > 0
        self.assertGreater(summary["overall"]["tool_selection_accuracy_sd"], 0)
        self.assertEqual(summary["stability"]["scenarios_fully_passing_all_reps"], 1)
        self.assertEqual(summary["stability"]["flaky_scenarios"], ["search-01"])
        self.assertIn("과목검색", summary["by_category"])

    def test_over_under_call_rates(self):
        rows = [
            _turn(1, "oos-01", "범위밖", {"expect_tool": "none"}, [_tc("search_courses")]),  # over-call
            _turn(1, "oos-02", "범위밖", {"expect_tool": "none"}, []),                       # ok
            _turn(1, "s-01", "잔여석", {"expect_tool": "search_courses"}, []),               # under-call
        ]
        summary = summarize(rows, n_reps=1, meta={})
        self.assertEqual(summary["overall"]["over_call"]["hit"], 1)
        self.assertEqual(summary["overall"]["over_call"]["n"], 2)
        self.assertEqual(summary["overall"]["under_call"]["hit"], 1)

    def test_errors_excluded_from_metrics(self):
        rows = [
            _turn(1, "a", "x", {"expect_tool": "any"}, [_tc("search_courses")]),
            _turn(1, "b", "x", {"expect_tool": "any"}, [], error="boom"),
        ]
        summary = summarize(rows, n_reps=1, meta={})
        self.assertEqual(summary["overall"]["n_errors"], 1)
        self.assertEqual(summary["overall"]["tool_selection_accuracy"], 1.0)  # 오류 turn 제외

    def test_skipped_turns_not_counted_as_errors(self):
        # 멀티턴 turn0 실패 → turn1은 skipped. 실패는 1건, skipped는 1건이어야
        t0 = _turn(1, "mt", "멀티턴", {"expect_tool": "search_courses"}, [], error="boom")
        t1 = _turn(1, "mt", "멀티턴", {"expect_tool": "ignore"}, [], answer="")
        t1["error"] = "이전 turn 실패로 건너뜀"
        t1["skipped"] = True
        summary = summarize([t0, t1], n_reps=1, meta={})
        self.assertEqual(summary["overall"]["n_errors"], 1)
        self.assertEqual(summary["overall"]["n_skipped"], 1)
        self.assertEqual(summary["overall"]["n_turns"], 2)
        # 채점 가능한 turn이 하나도 없으니 안정성 분모에서 빠진다
        self.assertEqual(summary["stability"]["scenarios_scored"], 0)


if __name__ == "__main__":
    unittest.main()
