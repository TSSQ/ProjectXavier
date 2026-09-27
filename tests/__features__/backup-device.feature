Feature: A backup names the device that made it, from the hardware model
  Xavier is iPhone-only, so on an iPad it runs in iPhone compatibility mode
  and the interface idiom (Platform.isPad) reports a phone: every iPad
  backup was labelled "iPhone" (user report, build 125). The hardware model
  identifier stays truthful, so it decides; the idiom is only the fallback.

  Scenario Outline: The hardware model decides, whatever the idiom says
    Then model <model> with idiom <idiom> should be labelled "<device>"

    Examples:
      | model        | idiom | device |
      | "iPad13,4"   | phone | iPad   |
      | "iPad16,3"   | phone | iPad   |
      | "iPhone17,2" | phone | iPhone |
      | "iPhone18,1" | pad   | iPhone |

  Scenario Outline: Without a usable model, the idiom is the fallback
    Then model <model> with idiom <idiom> should be labelled "<device>"

    Examples:
      | model   | idiom | device |
      | null    | pad   | iPad   |
      | null    | phone | iPhone |
      | "arm64" | pad   | iPad   |
      | ""      | phone | iPhone |
      | "iPod9,1" | phone | iPhone |

  Scenario: The iPad label survives the filename round trip
    Then a backup built on model "iPad13,4" should list as "iPad"
