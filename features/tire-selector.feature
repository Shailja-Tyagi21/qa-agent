@sanity @tire
Feature: Tire search widget

  As someone shopping for tires
  I want to use the tire search widget on the homepage
  So that I can start finding the right tire for my vehicle

  Background:
    Given I am on the "home" page

  @tire @smoke
  Scenario: The homepage loads with the tire search widget
    Then the "tire search widget" should be visible
    And the "page heading" should be visible
    And I should see at least 1 "productline tabs"
    And there should be no console errors

  @tire @widget
  Scenario: Switching productline changes the active tab
    Then the "Auto" productline tab should be "active"
    When I select the "Motorcycle" productline
    Then the "Motorcycle" productline tab should be "active"
    And the "Auto" productline tab should be "inactive"

  @tire @modal
  Scenario: The search-by-vehicle modal opens and closes
    When I open the tire search modal via "Search by Vehicle"
    Then the tire search modal should be open
    When I close the tire search modal
    Then the tire search modal should be closed
