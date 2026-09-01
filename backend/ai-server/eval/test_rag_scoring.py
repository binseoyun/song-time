"""rag_scoring.py 단위 테스트 (이슈 #104).

    python -m unittest eval.test_rag_scoring
"""
import unittest

from eval.rag_scoring import score_agent, score_naive, score_retrieval, summarize_rag

CALL = lambda name, obs=None: {"tool": name, "tool_input": {}, "observation": obs}


class ScoreAgentHit(unittest.TestCase):
    def _item(self, **kw):
        base = {"id": "x", "category": "의미검색", "expect_kind": "hit", "expect_course_code": "21000549"}
        return {**base, **kw}

    def test_hit_top1(self):
        s = score_agent(self._item(), [CALL("search_syllabus")], ["21000549", "21003761"], "알고리즘 과목")
        self.assertTrue(s["hit_at_1"] and s["hit_at_3"] and s["pass"])

    def test_hit_rank3_only(self):
        s = score_agent(self._item(), [CALL("search_syllabus")], ["a", "b", "21000549"], "알고리즘")
        self.assertFalse(s["hit_at_1"])
        self.assertTrue(s["hit_at_3"] and s["pass"])

    def test_miss_when_not_in_topk(self):
        s = score_agent(self._item(), [CALL("search_syllabus")], ["a", "b", "c"], "몰라요")
        self.assertFalse(s["hit_at_3"] or s["pass"])

    def test_array_expect_any_ok(self):
        it = self._item(expect_course_code=["21105378", "21002031"])
        s = score_agent(it, [CALL("search_syllabus")], ["21002031"], "네트워크보안")
        self.assertTrue(s["hit_at_1"] and s["pass"])

    def test_hit_fails_if_search_not_called(self):
        s = score_agent(self._item(), [CALL("search_courses")], None, "알고리즘")
        self.assertFalse(s["search_syllabus_called"] or s["pass"])

    def test_hit_fails_on_forbidden_string(self):
        it = self._item(answer_must_not_include=["없습니다"])
        s = score_agent(it, [CALL("search_syllabus")], ["21000549"], "그런 수업은 없습니다")
        self.assertFalse(s["answer_no_hallucination"])
        self.assertFalse(s["pass"])


class ScoreAgentOther(unittest.TestCase):
    def test_not_registered_no_forbidden(self):
        it = {"id": "y", "category": "미등록", "expect_kind": "not_registered",
              "answer_must_not_include": ["중간", "기말"]}
        ok = score_agent(it, [CALL("get_syllabus")], None, "강의계획서가 등록되어 있지 않습니다")
        bad = score_agent(it, [CALL("get_syllabus")], None, "중간 40 기말 60입니다")
        self.assertTrue(ok["pass"])
        self.assertFalse(bad["pass"])

    def test_not_registered_no_label_uses_phrase(self):
        it = {"id": "y", "category": "미등록", "expect_kind": "not_registered"}
        self.assertTrue(score_agent(it, [], None, "등록되어 있지 않습니다")["pass"])
        self.assertFalse(score_agent(it, [], None, "3학점입니다")["pass"])

    def test_out_of_scope_pass_when_no_syllabus_tool(self):
        it = {"id": "z", "category": "범위밖", "expect_kind": "out_of_scope"}
        self.assertTrue(score_agent(it, [CALL("get_course_by_code")], None, "100석")["pass"])
        self.assertFalse(score_agent(it, [CALL("get_syllabus")], None, "...")["pass"])

    def test_out_of_scope_expect_none(self):
        it = {"id": "z", "category": "범위밖", "expect_kind": "out_of_scope", "expect_tool": "none"}
        self.assertTrue(score_agent(it, [], None, "화면에서 확인하세요")["pass"])
        self.assertFalse(score_agent(it, [CALL("search_courses")], None, "...")["pass"])

    def test_routing_specific_tool(self):
        it = {"id": "r", "category": "라우팅", "expect_kind": "routing", "expect_tool": "search_courses"}
        self.assertTrue(score_agent(it, [CALL("search_courses")], None, "...")["pass"])
        self.assertFalse(score_agent(it, [CALL("get_syllabus")], None, "...")["pass"])

    def test_routing_none_fails_on_any_call(self):
        it = {"id": "r", "category": "라우팅", "expect_kind": "routing", "expect_tool": "none"}
        self.assertTrue(score_agent(it, [], None, "날씨는 몰라요")["pass"])
        self.assertFalse(score_agent(it, [CALL("search_courses")], None, "...")["pass"])


class ScoreAgentSyllabusFollowup(unittest.TestCase):
    def _item(self, **kw):
        base = {
            "id": "f", "category": "후속", "expect_kind": "syllabus_followup",
            "expect_tool_lastturn": "get_syllabus",
            "answer_must_include": ["jshim@sookmyung.ac.kr"],
            "answer_must_not_include": ["university.ac.kr", "jhshim"],
        }
        return {**base, **kw}

    def test_pass_when_recalled_and_correct(self):
        s = score_agent(self._item(), [CALL("search_courses"), CALL("get_syllabus")], None,
                        "심준호 교수님의 이메일 주소는 jshim@sookmyung.ac.kr 입니다.")
        self.assertTrue(s["lastturn_tool_ok"] and s["answer_correct"] and s["pass"])

    def test_fail_when_no_tool_and_hallucinated(self):
        s = score_agent(self._item(), [], None,
                        "심준호 교수님의 이메일 주소는 jhshim@university.ac.kr 입니다.")
        self.assertFalse(s["lastturn_tool_ok"])
        self.assertFalse(s["answer_correct"])
        self.assertFalse(s["answer_no_hallucination"])
        self.assertFalse(s["pass"])

    def test_fail_when_tool_called_but_wrong_answer(self):
        s = score_agent(self._item(), [CALL("get_syllabus")], None, "이메일은 모르겠습니다.")
        self.assertTrue(s["lastturn_tool_ok"])
        self.assertFalse(s["pass"])

    def test_summarize_followup_block(self):
        rows = [
            {"scenario_id": "rag-54", "category": "후속", "rep": 1, "error": None,
             "scores": {"expect_kind": "syllabus_followup", "lastturn_tool_ok": True,
                        "answer_correct": True, "answer_no_hallucination": True, "pass": True}},
            {"scenario_id": "rag-55", "category": "후속", "rep": 1, "error": None,
             "scores": {"expect_kind": "syllabus_followup", "lastturn_tool_ok": False,
                        "answer_correct": False, "answer_no_hallucination": False, "pass": False}},
        ]
        out = summarize_rag(rows, 1, {"mode": "agent"})
        b = out["by_kind"]["syllabus_followup"]
        self.assertEqual(b["pass_rate"], 0.5)
        self.assertEqual(b["lastturn_tool_ok_rate"], 0.5)


class ScoreRetrievalNaive(unittest.TestCase):
    def test_retrieval_hit(self):
        it = {"id": "x", "expect_kind": "hit", "expect_course_code": "21000549"}
        self.assertTrue(score_retrieval(it, ["21000549"])["pass"])
        self.assertFalse(score_retrieval(it, ["99999999"])["pass"])

    def test_naive_hit_needs_name(self):
        it = {"id": "x", "expect_kind": "hit", "expect_course_code": "21000549"}
        names = {"21000549": "알고리즘"}
        self.assertTrue(score_naive(it, "알고리즘 과목을 추천합니다", names)["pass"])
        self.assertFalse(score_naive(it, "잘 모르겠습니다", names)["pass"])

    def test_naive_skips_out_of_scope(self):
        it = {"id": "z", "expect_kind": "out_of_scope"}
        self.assertIsNone(score_naive(it, "...", {})["pass"])


class Summarize(unittest.TestCase):
    def test_by_kind_and_overall(self):
        rows = [
            {"scenario_id": "a", "category": "의미검색", "rep": 1, "error": None,
             "scores": {"expect_kind": "hit", "hit_at_1": True, "hit_at_3": True, "hit_at_5": True,
                        "search_syllabus_called": True, "answer_names_course": None, "pass": True}},
            {"scenario_id": "b", "category": "의미검색", "rep": 1, "error": None,
             "scores": {"expect_kind": "hit", "hit_at_1": False, "hit_at_3": True, "hit_at_5": True,
                        "search_syllabus_called": True, "answer_names_course": None, "pass": True}},
            {"scenario_id": "c", "category": "범위밖", "rep": 1, "error": None,
             "scores": {"expect_kind": "out_of_scope", "syllabus_tool_called": False, "pass": True}},
        ]
        out = summarize_rag(rows, 1, {"mode": "agent"})
        self.assertEqual(out["overall_pass_rate"], 1.0)
        self.assertEqual(out["by_kind"]["hit"]["hit_at_1"], 0.5)
        self.assertEqual(out["by_kind"]["hit"]["hit_at_3"], 1.0)
        self.assertEqual(out["stability"]["fully_passing_all_reps"], 3)


if __name__ == "__main__":
    unittest.main()
